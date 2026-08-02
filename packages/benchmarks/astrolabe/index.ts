import { execFile } from "node:child_process";
import { readdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const extension = resolve(root, "extensions/astrolabe/index.ts");
const pi = process.env.PI_BIN ?? "pi";

type Mode = "without-astrolabe" | "with-astrolabe";
type Language = "typescript" | "javascript" | "python" | "go";

interface Task {
  id: string;
  language: Language;
  file: string;
  source: string;
  expected: string;
  prompt: string;
}

interface ToolEvent {
  type: "tool_execution_start" | "tool_execution_end";
  toolName: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
}

interface RunResult {
  task: string;
  language: Language;
  mode: Mode;
  success: boolean;
  exitCode: number;
  elapsedMs: number;
  toolCalls: number;
  failedToolCalls: number;
  astrolabeCalls: number;
  ordinaryReadEditCalls: number;
  inputChars: number;
  outputChars: number;
  inputTokens: number;
  outputTokens: number;
  actual: string;
  stderr: string;
}

const tasks: readonly Task[] = [
  {
    id: "typescript-single-edit",
    language: "typescript",
    file: "sample.ts",
    source: "export function answer(): number { return 1; }\n",
    expected: "export function answer(): number { return 2; }\n",
    prompt:
      "In sample.ts, change answer() so it returns 2 instead of 1. Do not change anything else.",
  },
  {
    id: "typescript-multiple-edit",
    language: "typescript",
    file: "sample.ts",
    source:
      "export function first(): number { return 1; }\nexport function second(): number { return 3; }\n",
    expected:
      "export function first(): number { return 2; }\nexport function second(): number { return 4; }\n",
    prompt:
      "In sample.ts, change first() to return 2 and second() to return 4. Do not change anything else.",
  },
  {
    id: "javascript-single-edit",
    language: "javascript",
    file: "sample.js",
    source: "export function answer() { return 1; }\n",
    expected: "export function answer() { return 2; }\n",
    prompt:
      "In sample.js, change answer() so it returns 2 instead of 1. Do not change anything else.",
  },
  {
    id: "javascript-multiple-edit",
    language: "javascript",
    file: "sample.js",
    source: "export function first() { return 1; }\nexport function second() { return 3; }\n",
    expected: "export function first() { return 2; }\nexport function second() { return 4; }\n",
    prompt:
      "In sample.js, change first() to return 2 and second() to return 4. Do not change anything else.",
  },
  {
    id: "python-single-edit",
    language: "python",
    file: "sample.py",
    source: "def answer():\n    return 1\n",
    expected: "def answer():\n    return 2\n",
    prompt:
      "In sample.py, change answer() so it returns 2 instead of 1. Do not change anything else.",
  },
  {
    id: "python-multiple-edit",
    language: "python",
    file: "sample.py",
    source: "def first():\n    return 1\n\ndef second():\n    return 3\n",
    expected: "def first():\n    return 2\n\ndef second():\n    return 4\n",
    prompt:
      "In sample.py, change first() to return 2 and second() to return 4. Do not change anything else.",
  },
  {
    id: "go-single-edit",
    language: "go",
    file: "sample.go",
    source: "package sample\n\nfunc Answer() int { return 1 }\n",
    expected: "package sample\n\nfunc Answer() int { return 2 }\n",
    prompt:
      "In sample.go, change Answer() so it returns 2 instead of 1. Do not change anything else.",
  },
  {
    id: "go-multiple-edit",
    language: "go",
    file: "sample.go",
    source: "package sample\n\nfunc First() int { return 1 }\nfunc Second() int { return 3 }\n",
    expected: "package sample\n\nfunc First() int { return 2 }\nfunc Second() int { return 4 }\n",
    prompt:
      "In sample.go, change First() to return 2 and Second() to return 4. Do not change anything else.",
  },
];

function parseOptions(argv: readonly string[]) {
  let model: string | undefined;
  let repetitions = 1;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--model") model = argv[++index];
    else if (argument === "--repetitions") repetitions = Number(argv[++index]);
    else if (argument === "--task") selectedTask = argv[++index];
    else if (argument === "--help") {
      console.log(
        "Usage: bun packages/benchmarks/astrolabe/index.ts [--model MODEL] [--repetitions N] [--task ID]",
      );
      process.exit(0);
    }
  }
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new Error("--repetitions must be a positive integer");
  }
  return { model, repetitions };
}

let selectedTask: string | undefined;

function chars(value: unknown): number {
  return JSON.stringify(value ?? null).length;
}

function tokens(value: number): number {
  return Math.ceil(value / 4);
}

function parseEvents(stdout: string): ToolEvent[] {
  const events: ToolEvent[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as ToolEvent;
      if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
        events.push(event);
      }
    } catch {
      // Preserve the run result; pi may write non-JSON diagnostics to stdout.
    }
  }
  return events;
}

async function discoverLanguages(): Promise<Set<string>> {
  const entries = await readdir(join(root, "extensions/astrolabe/languages"), {
    withFileTypes: true,
  });
  return new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
}

async function runTask(task: Task, mode: Mode, model: string | undefined): Promise<RunResult> {
  const directory = await mkdtemp(join("/tmp", "astrolabe-session-benchmark-"));
  const path = join(directory, task.file);
  await writeFile(path, task.source);
  const args = ["--no-session", "--mode", "json", "--no-extensions", "--approve"];
  if (mode === "with-astrolabe") args.push("-e", extension);
  if (model) args.push("--model", model);
  args.push(
    "-p",
    `${task.prompt} Work only in the current directory and finish after verifying the file.`,
  );

  const started = performance.now();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    const result = await execFileAsync(pi, args, {
      cwd: directory,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 10 * 60 * 1000,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; code?: number };
    stdout = failure.stdout ?? "";
    stderr = failure.stderr ?? String(error);
    exitCode = typeof failure.code === "number" ? failure.code : 1;
  }
  const events = parseEvents(stdout);
  const starts = events.filter((event) => event.type === "tool_execution_start");
  const ends = events.filter((event) => event.type === "tool_execution_end");
  const toolCalls = starts.length;
  const failedToolCalls = ends.filter((event) => event.isError).length;
  const astrolabeCalls = starts.filter((event) => event.toolName === "astrolabe").length;
  const ordinaryReadEditCalls = starts.filter(
    (event) => event.toolName === "read" || event.toolName === "edit",
  ).length;
  const inputChars = starts.reduce((total, event) => total + chars(event.args), 0);
  const outputChars = ends.reduce((total, event) => total + chars(event.result), 0);
  const actual = await readFile(path, "utf8").catch(() => "");
  await rm(directory, { recursive: true, force: true });
  return {
    task: task.id,
    language: task.language,
    mode,
    success: exitCode === 0 && actual === task.expected,
    exitCode,
    elapsedMs: performance.now() - started,
    toolCalls,
    failedToolCalls,
    astrolabeCalls,
    ordinaryReadEditCalls,
    inputChars,
    outputChars,
    inputTokens: tokens(inputChars),
    outputTokens: tokens(outputChars),
    actual,
    stderr,
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const languages = await discoverLanguages();
  const taskLanguages = new Set(tasks.map((task) => task.language));
  const missing = [...languages].filter((language) => !taskLanguages.has(language as Language));
  if (missing.length > 0)
    throw new Error(`Missing benchmark tasks for languages: ${missing.join(", ")}`);
  const selected = selectedTask ? tasks.filter((task) => task.id === selectedTask) : tasks;
  if (selected.length === 0) throw new Error(`Unknown task: ${selectedTask}`);

  const results: RunResult[] = [];
  for (let repetition = 0; repetition < options.repetitions; repetition++) {
    const modes: readonly Mode[] =
      repetition % 2 === 0
        ? ["without-astrolabe", "with-astrolabe"]
        : ["with-astrolabe", "without-astrolabe"];
    for (const task of selected) {
      for (const mode of modes) results.push(await runTask(task, mode, options.model));
    }
  }
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
}

await main();
