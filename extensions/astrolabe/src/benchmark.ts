import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { edit } from "./edit.ts";
import { inspect } from "./inspect.ts";
import { createMetrics, type Metrics } from "./metrics.ts";
import { HandleStore } from "./node-handles.ts";
import {
  clearFileCache,
  createTreeEdit,
  parseFile,
  parseSource,
  type ParsedFile,
} from "./parser.ts";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const tscPath = require.resolve("typescript/bin/tsc");

export type EditingMode = "A" | "B" | "C";
export type BenchmarkFormat = "table" | "json";

interface BenchmarkFile {
  path: string;
  source: string;
  expected: string;
  nodeType?: string;
  handleLabel?: string;
  replacement?: string;
}

export interface BenchmarkCase {
  id:
    | "add-import"
    | "remove-import"
    | "condition"
    | "function-body"
    | "add-argument"
    | "replace-expression"
    | "rewrite-function"
    | "new-file"
    | "multi-file";
  description: string;
  source: string;
  expected: string;
  nodeType?: string;
  handleLabel?: string;
  replacement?: string;
  preferAstrolabe: boolean;
  extraFiles?: readonly BenchmarkFile[];
}

export interface ParseTiming {
  iterations: number;
  fullMs: number;
  incrementalMs: number;
}

export interface BenchmarkResult {
  caseId: BenchmarkCase["id"];
  mode: EditingMode;
  selectedMode: "diff" | "astrolabe";
  applicability: "applicable" | "not_applicable";
  elapsedMs: number;
  success: boolean;
  unintendedChangedLines: number;
  metrics: Metrics;
  syntaxValid: boolean;
  typeCheck: "pass" | "fail" | "skipped";
  tests: "pass" | "fail" | "skipped";
  parseTiming?: ParseTiming;
  notApplicableReason?: string;
  error?: string;
}

export interface BenchmarkSummary {
  mode: EditingMode;
  tasks: number;
  applicableTasks: number;
  notApplicable: number;
  successfulEdits: number;
  syntaxValid: number;
  typeCheckPasses: number;
  testPasses: number;
  retries: number;
  elapsedMs: number;
}

export interface BenchmarkOptions {
  typeCheck?: boolean;
  parseIterations?: number;
  testCommand?: readonly [string, ...string[]];
}

const cases: readonly BenchmarkCase[] = [
  {
    id: "add-import",
    description: "importの追加",
    source: "export const answer = 42;\n",
    expected: 'import type { Answer } from "./helper.js";\nexport const answer: Answer = 42;\n',
    nodeType: "export_statement",
    handleLabel: "declaration.export",
    replacement: 'import type { Answer } from "./helper.js";\nexport const answer: Answer = 42;',
    preferAstrolabe: true,
    extraFiles: [
      {
        path: "helper.ts",
        source: "export type Answer = number;\n",
        expected: "export type Answer = number;\n",
      },
    ],
  },
  {
    id: "remove-import",
    description: "importの削除",
    source: 'import { helper } from "./helper.js";\nexport const answer = 42;\n',
    expected: "\nexport const answer = 42;\n",
    nodeType: "import_statement",
    handleLabel: "declaration.import",
    replacement: "",
    preferAstrolabe: true,
    extraFiles: [
      {
        path: "helper.ts",
        source: "export const helper = 1;\n",
        expected: "export const helper = 1;\n",
      },
    ],
  },
  {
    id: "condition",
    description: "関数内の条件式変更",
    source:
      "export function visible(value: number) { if (value > 0) return true; return false; }\n",
    expected:
      "export function visible(value: number) { if (value >= 0) return true; return false; }\n",
    nodeType: "binary_expression",
    replacement: "value >= 0",
    preferAstrolabe: true,
  },
  {
    id: "function-body",
    description: "関数本体の改善",
    source: "export function answer() { return 1 + 1; }\n",
    expected: "export function answer() { return 2; }\n",
    nodeType: "statement_block",
    replacement: "{ return 2; }",
    preferAstrolabe: true,
  },
  {
    id: "add-argument",
    description: "引数追加",
    source: "export function greet(name: string) { return name; }\n",
    expected:
      'export function greet(name: string, greeting = "hello") { return `${greeting} ${name}`; }\n',
    nodeType: "export_statement",
    handleLabel: "declaration.export",
    replacement:
      'export function greet(name: string, greeting = "hello") { return `${greeting} ${name}`; }',
    preferAstrolabe: true,
  },
  {
    id: "replace-expression",
    description: "1つの式の置換",
    source: "export const answer = 1 + 1;\n",
    expected: "export const answer = 2;\n",
    nodeType: "binary_expression",
    replacement: "2",
    preferAstrolabe: true,
  },
  {
    id: "rewrite-function",
    description: "関数全体の書き換え",
    source: "export function format(value: string) { return value; }\n",
    expected: "export function format(value: string) {\n  return value.trim().toUpperCase();\n}\n",
    nodeType: "export_statement",
    handleLabel: "declaration.export",
    replacement: "export function format(value: string) {\n  return value.trim().toUpperCase();\n}",
    preferAstrolabe: false,
  },
  {
    id: "new-file",
    description: "新規ファイル作成",
    source: "",
    expected: "export const created = true;\n",
    preferAstrolabe: false,
  },
  {
    id: "multi-file",
    description: "複数ファイルをまたぐ変更",
    source: 'export { value } from "./value.js";\n',
    expected: 'export { value, nextValue } from "./value.js";\n',
    nodeType: "export_statement",
    handleLabel: "declaration.export",
    replacement: 'export { value, nextValue } from "./value.js";',
    preferAstrolabe: false,
    extraFiles: [
      {
        path: "value.ts",
        source: "export const value = 1;\n",
        expected: "export const value = 1;\nexport const nextValue = 2;\n",
        nodeType: "export_statement",
        handleLabel: "declaration.export",
        replacement: "export const value = 1;\nexport const nextValue = 2;",
      },
    ],
  },
];

function filesOf(definition: BenchmarkCase): BenchmarkFile[] {
  return [
    {
      path: "sample.ts",
      source: definition.source,
      expected: definition.expected,
      ...(definition.nodeType ? { nodeType: definition.nodeType } : {}),
      ...(definition.handleLabel ? { handleLabel: definition.handleLabel } : {}),
      ...(definition.replacement !== undefined ? { replacement: definition.replacement } : {}),
    },
    ...(definition.extraFiles ?? []),
  ];
}

function changedLineCount(before: string, after: string): number {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const limit = Math.max(beforeLines.length, afterLines.length);
  let changed = 0;
  for (let index = 0; index < limit; index++) {
    if (beforeLines[index] !== afterLines[index]) changed++;
  }
  return changed;
}

function nodeOfType(file: ParsedFile, type: string) {
  const visit = (node: typeof file.tree.rootNode): typeof file.tree.rootNode | undefined => {
    if (node.type === type) return node;
    for (const child of node.namedChildren) {
      if (!child) continue;
      const found = visit(child);
      if (found) return found;
    }
    return undefined;
  };
  return visit(file.tree.rootNode);
}

function addInput(metrics: Metrics, text: string): void {
  metrics.inputChars += text.length;
  metrics.inputTokens += Math.ceil(text.length / 4);
}

function addOutput(metrics: Metrics, text: string): void {
  metrics.outputChars += text.length;
  metrics.outputTokens += Math.ceil(text.length / 4);
}

async function runDiffCase(
  files: readonly BenchmarkFile[],
  directory: string,
  metrics: Metrics,
): Promise<void> {
  for (const fixture of files) {
    if (fixture.source === fixture.expected) continue;
    const path = join(directory, fixture.path);
    if (fixture.source !== "") {
      addInput(metrics, await readFile(path, "utf8"));
      metrics.calls++;
    }
    addOutput(metrics, fixture.expected);
    await writeFile(path, fixture.expected, "utf8");
    metrics.calls++;
  }
}

function handleIdsFromOutput(output: string, label: string): string[] {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...output.matchAll(new RegExp(`^[ \\t]*nodeId=(n\\d+) ${escapedLabel}(?:\\s|$)`, "gm"))]
    .map((match) => match[1])
    .filter((nodeId): nodeId is string => nodeId !== undefined);
}

function firstHandleId(output: string): string | undefined {
  return /^[ \t]*nodeId=(n\d+) /m.exec(output)?.[1];
}

function requireSingleHandle(output: string, label: string): string {
  const nodeIds = handleIdsFromOutput(output, label);
  if (nodeIds.length !== 1) {
    throw new Error(`Expected one ${label} handle in syntax_inspect output`);
  }
  return nodeIds[0] as string;
}

async function runAstrolabeEdit(
  fixture: BenchmarkFile,
  directory: string,
  handles: HandleStore,
  metrics: Metrics,
): Promise<void> {
  if (!fixture.nodeType || fixture.replacement === undefined) {
    throw new Error(`Astrolabe cannot create ${fixture.path} without a syntax node`);
  }
  const path = join(directory, fixture.path);
  const targetLabel = fixture.handleLabel ?? fixture.nodeType;
  const outlineOutput = await inspect({ path, view: "outline" }, directory, handles);
  metrics.calls++;
  metrics.fullParses++;
  addInput(metrics, outlineOutput);
  const outlineTargetIds = handleIdsFromOutput(outlineOutput, targetLabel);
  const containerId =
    outlineTargetIds.length === 1 ? outlineTargetIds[0] : firstHandleId(outlineOutput);
  if (!containerId) {
    throw new Error(`No expandable declaration in syntax_inspect outline for ${fixture.path}`);
  }
  const structureOutput = await inspect(
    { path, nodeId: containerId, view: "structure", depth: 12 },
    directory,
    handles,
  );
  metrics.calls++;
  addInput(metrics, structureOutput);
  const nodeId = requireSingleHandle(
    structureOutput,
    outlineTargetIds.length === 1 ? targetLabel : fixture.nodeType,
  );
  const sourceOutput = await inspect({ path, nodeId, view: "source" }, directory, handles);
  metrics.calls++;
  addInput(metrics, sourceOutput);
  const result = await edit({ path, nodeId, replacement: fixture.replacement }, directory, handles);
  metrics.calls++;
  metrics.incrementalParses++;
  addOutput(metrics, fixture.replacement);
  if (!result.startsWith("edited ")) throw new Error(result);
}

async function runAstrolabeCase(
  files: readonly BenchmarkFile[],
  directory: string,
  metrics: Metrics,
): Promise<void> {
  const handles = new HandleStore();
  for (const fixture of files) {
    if (fixture.source !== fixture.expected) {
      await runAstrolabeEdit(fixture, directory, handles, metrics);
    }
  }
}

async function checkTypeScript(
  directory: string,
  files: readonly BenchmarkFile[],
): Promise<"pass" | "fail"> {
  const configPath = join(directory, "tsconfig.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        compilerOptions: {
          noEmit: true,
          strict: true,
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
        },
        files: files.map((file) => file.path),
      },
      null,
      2,
    ),
  );
  try {
    await execFileAsync(process.execPath, [tscPath, "--project", configPath], { cwd: directory });
    return "pass";
  } catch {
    return "fail";
  }
}

function astrolabeNotApplicableReason(files: readonly BenchmarkFile[]): string | undefined {
  const newFile = files.find((fixture) => fixture.source === "" && fixture.expected !== "");
  if (newFile) return `Astrolabe cannot create ${newFile.path} without a syntax node`;
  const missingNode = files.find(
    (fixture) =>
      fixture.source !== fixture.expected &&
      (!fixture.nodeType || fixture.replacement === undefined),
  );
  return missingNode ? `Astrolabe has no syntax target for ${missingNode.path}` : undefined;
}

async function runTests(
  directory: string,
  command: BenchmarkOptions["testCommand"],
): Promise<"pass" | "fail" | "skipped"> {
  if (!command) return "skipped";
  const [file, ...args] = command;
  try {
    await execFileAsync(file, args, { cwd: directory });
    return "pass";
  } catch {
    return "fail";
  }
}

async function benchmarkParsing(
  definition: BenchmarkCase,
  iterations: number,
): Promise<ParseTiming | undefined> {
  if (!definition.nodeType || definition.replacement === undefined || definition.source === "") {
    return undefined;
  }
  const before = await parseSource("benchmark.ts", definition.source);
  try {
    const node = nodeOfType(before, definition.nodeType);
    if (!node) return undefined;
    const treeEdit = createTreeEdit(
      definition.source,
      node.startIndex,
      node.endIndex,
      definition.replacement,
    );
    const nextSource =
      definition.source.slice(0, node.startIndex) +
      definition.replacement +
      definition.source.slice(node.endIndex);
    const incrementalStarted = performance.now();
    for (let index = 0; index < iterations; index++) {
      const parsed = await parseSource("benchmark.ts", nextSource, {
        previous: { file: before, edit: treeEdit },
      });
      parsed.tree.delete();
    }
    const incrementalMs = (performance.now() - incrementalStarted) / iterations;
    const fullStarted = performance.now();
    for (let index = 0; index < iterations; index++) {
      const parsed = await parseSource("benchmark.ts", nextSource);
      parsed.tree.delete();
    }
    return {
      iterations,
      fullMs: (performance.now() - fullStarted) / iterations,
      incrementalMs,
    };
  } finally {
    before.tree.delete();
  }
}

async function runCase(
  definition: BenchmarkCase,
  mode: EditingMode,
  options: BenchmarkOptions,
  parseTiming: ParseTiming | undefined,
): Promise<BenchmarkResult> {
  const directory = await mkdtemp(join(tmpdir(), "astrolabe-benchmark-"));
  const files = filesOf(definition);
  const selectedMode =
    mode === "C"
      ? definition.preferAstrolabe
        ? "astrolabe"
        : "diff"
      : mode === "B"
        ? "astrolabe"
        : "diff";
  const notApplicableReason =
    selectedMode === "astrolabe" ? astrolabeNotApplicableReason(files) : undefined;
  const applicability = notApplicableReason ? "not_applicable" : "applicable";
  const metrics = createMetrics();
  const started = performance.now();
  let success = false;
  let syntaxValid = false;
  let typeCheck: BenchmarkResult["typeCheck"] = "skipped";
  let tests: BenchmarkResult["tests"] = "skipped";
  let error: string | undefined;
  let unintendedChangedLines = 0;
  try {
    if (!notApplicableReason) {
      for (const fixture of files) {
        if (fixture.source !== "")
          await writeFile(join(directory, fixture.path), fixture.source, "utf8");
      }
      if (selectedMode === "astrolabe") await runAstrolabeCase(files, directory, metrics);
      else await runDiffCase(files, directory, metrics);

      const actualFiles: Array<{ fixture: BenchmarkFile; actual: string | undefined }> =
        await Promise.all(
          files.map(async (fixture) => {
            try {
              return { fixture, actual: await readFile(join(directory, fixture.path), "utf8") };
            } catch {
              return { fixture, actual: undefined };
            }
          }),
        );
      success = actualFiles.every(({ fixture, actual }) => actual === fixture.expected);
      unintendedChangedLines = actualFiles.reduce(
        (total, { fixture, actual }) => total + changedLineCount(fixture.expected, actual ?? ""),
        0,
      );
      if (actualFiles.every(({ actual }) => actual !== undefined)) {
        syntaxValid = true;
        for (const { fixture } of actualFiles) {
          const parsed = await parseFile(join(directory, fixture.path));
          metrics.syntaxChecks++;
          metrics.fullParses++;
          if (parsed.syntaxErrors !== 0) syntaxValid = false;
        }
        if (syntaxValid) metrics.syntaxSuccesses++;
      }
      if (success && options.typeCheck !== false) {
        metrics.typeChecks++;
        typeCheck = await checkTypeScript(directory, files);
        if (typeCheck === "pass") metrics.typeCheckSuccesses++;
      }
      if (success && options.testCommand) {
        metrics.testChecks++;
        tests = await runTests(directory, options.testCommand);
        if (tests === "pass") metrics.testSuccesses++;
      }
    }
  } catch (caught) {
    error = String(caught);
  } finally {
    metrics.elapsedMs = performance.now() - started;
    for (const fixture of files) clearFileCache(join(directory, fixture.path));
    await rm(directory, { recursive: true, force: true });
  }
  return {
    caseId: definition.id,
    mode,
    selectedMode,
    applicability,
    elapsedMs: metrics.elapsedMs,
    success,
    unintendedChangedLines,
    metrics,
    syntaxValid,
    typeCheck,
    tests,
    ...(parseTiming ? { parseTiming } : {}),
    ...(notApplicableReason ? { notApplicableReason } : {}),
    ...(error ? { error } : {}),
  };
}

export async function runBenchmark(
  modes: readonly EditingMode[] = ["A", "B", "C"],
  options: BenchmarkOptions = {},
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  const iterations = options.parseIterations ?? 25;
  for (const definition of cases) {
    const parseTiming = await benchmarkParsing(definition, iterations);
    for (const mode of modes) results.push(await runCase(definition, mode, options, parseTiming));
  }
  return results;
}

export function summarizeBenchmark(results: readonly BenchmarkResult[]): BenchmarkSummary[] {
  return (["A", "B", "C"] as const).flatMap((mode) => {
    const forMode = results.filter((result) => result.mode === mode);
    if (forMode.length === 0) return [];
    const applicable = forMode.filter((result) => result.applicability === "applicable");
    return [
      {
        mode,
        tasks: forMode.length,
        applicableTasks: applicable.length,
        notApplicable: forMode.length - applicable.length,
        successfulEdits: applicable.filter((result) => result.success).length,
        syntaxValid: applicable.filter((result) => result.syntaxValid).length,
        typeCheckPasses: applicable.filter((result) => result.typeCheck === "pass").length,
        testPasses: applicable.filter((result) => result.tests === "pass").length,
        retries: applicable.reduce((total, result) => total + result.metrics.retries, 0),
        elapsedMs: forMode.reduce((total, result) => total + result.elapsedMs, 0),
      },
    ];
  });
}

export function formatBenchmark(
  results: readonly BenchmarkResult[],
  format: BenchmarkFormat,
): string {
  const summary = summarizeBenchmark(results);
  if (format === "json") return JSON.stringify({ results, summary }, null, 2);
  const rows = results.map((result) => [
    result.caseId,
    result.mode,
    result.selectedMode,
    result.applicability,
    result.applicability === "not_applicable" ? "n/a" : result.success ? "pass" : "fail",
    result.syntaxValid ? "pass" : "fail",
    result.typeCheck,
    result.tests,
    result.elapsedMs.toFixed(2),
    result.parseTiming?.fullMs.toFixed(3) ?? "-",
    result.parseTiming?.incrementalMs.toFixed(3) ?? "-",
    String(result.metrics.inputTokens),
    String(result.metrics.outputTokens),
    String(result.metrics.calls),
    String(result.unintendedChangedLines),
  ]);
  const headers = [
    "task",
    "mode",
    "selected",
    "applicability",
    "edit",
    "syntax",
    "type",
    "test",
    "ms",
    "full parse",
    "inc parse",
    "in tok",
    "out tok",
    "calls",
    "extra lines",
  ];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const render = (row: readonly string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join(" | ");
  const summaryRows = summary.map((entry) => [
    entry.mode,
    `${entry.successfulEdits}/${entry.applicableTasks}`,
    `${entry.syntaxValid}/${entry.applicableTasks}`,
    String(entry.notApplicable),
    String(entry.typeCheckPasses),
    String(entry.testPasses),
    String(entry.retries),
    entry.elapsedMs.toFixed(2),
  ]);
  const summaryHeaders = [
    "mode",
    "edit success",
    "syntax",
    "not applicable",
    "type pass",
    "test pass",
    "retries",
    "total ms",
  ];
  const summaryWidths = summaryHeaders.map((header, index) =>
    Math.max(header.length, ...summaryRows.map((row) => row[index]?.length ?? 0)),
  );
  const renderSummary = (row: readonly string[]) =>
    row.map((cell, index) => cell.padEnd(summaryWidths[index] ?? cell.length)).join(" | ");
  return [
    render(headers),
    widths.map((width) => "-".repeat(width)).join("-|-"),
    ...rows.map(render),
    "",
    "Summary",
    renderSummary(summaryHeaders),
    summaryWidths.map((width) => "-".repeat(width)).join("-|-"),
    ...summaryRows.map(renderSummary),
  ].join("\n");
}
