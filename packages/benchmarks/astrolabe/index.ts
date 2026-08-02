import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { basename, join, resolve } from "node:path";

const execFileAsync = promisify(execFile);
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const extension = resolve(root, "extensions/astrolabe/index.ts");
const pi = process.env.PI_BIN ?? "pi";

type Mode = "without-astrolabe" | "with-astrolabe";
type Language = "typescript";

interface TaskDefinition {
  id: string;
  sourcePath: string;
  oldText: string;
  newText: string;
  prompt: string;
}

interface Task extends TaskDefinition {
  language: Language;
  file: string;
  source: string;
  expected: string;
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
  sourceChars: number;
  sourceLines: number;
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

const taskDefinitions: readonly TaskDefinition[] = [
  {
    id: "grill-plan-large-file",
    sourcePath: "extensions/grill-plan/index.ts",
    oldText: 'description: "Start in Grill Plan mode",',
    newText: 'description: "Start the Grill Plan mode",',
    prompt: "In the TypeScript source file, change the description to say ‘Start the Grill Plan mode’. Do not change anything else.",
  },
  {
    id: "agent-team-index",
    sourcePath: "extensions/agent-team/index.ts",
    oldText: 'promptSnippet: "Choose constructive committee or adversarial review for a difficult question",',
    newText: 'promptSnippet: "Choose committee or adversarial review for a difficult question",',
    prompt: "In the TypeScript source file, shorten the agent-team promptSnippet by removing ‘constructive ’. Do not change anything else.",
  },
  {
    id: "agent-team-coordination",
    sourcePath: "extensions/agent-team/team.ts",
    oldText: "// 500ms stagger avoids concurrent API requests from multiple child Pi",
    newText: "// A 500ms stagger avoids concurrent API requests from multiple child Pi",
    prompt: "In the TypeScript source file, improve the first coordination comment by adding ‘A ’ at its start. Do not change anything else.",
  },
  {
    id: "session-metrics-report",
    sourcePath: "packages/session-metrics/src/report.ts",
    oldText: '      title("Session Metrics"),',
    newText: '      title("Session Metrics Report"),',
    prompt: "In the TypeScript source file, change the report title from ‘Session Metrics’ to ‘Session Metrics Report’. Do not change anything else.",
  },
];

async function loadTasks(): Promise<readonly Task[]> {
  return Promise.all(
    taskDefinitions.map(async (definition) => {
      const source = await readFile(join(root, definition.sourcePath), "utf8");
      const occurrences = source.split(definition.oldText).length - 1;
      if (occurrences !== 1) {
        throw new Error(`${definition.sourcePath}: expected one task target, found ${occurrences}`);
      }
      return {
        ...definition,
        language: "typescript" as const,
        file: basename(definition.sourcePath),
        source,
        expected: source.replace(definition.oldText, definition.newText),
      };
    }),
  );
}

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
    sourceChars: task.source.length,
    sourceLines: task.source.split("\n").length - 1,
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
  const tasks = await loadTasks();
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
