import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Dirent } from "node:fs";

export type ProcessPhase = "pending" | "running" | "unchecked" | "completed";
export type ProcessOutcome = "success" | "failed" | "stopped" | "lost";

export type ProcessSpec =
  | { type: "shell"; command: string; stdin?: string }
  | { type: "argv"; executable: string; args: string[]; stdin?: string };

export interface ProcessRequest {
  version: 1;
  id: string;
  label: string;
  kind: string;
  ownerSessionId: string;
  cwd: string;
  createdAt: string;
  spec: ProcessSpec;
}

export interface RunningState {
  supervisorPid: number;
  childPid: number;
  startedAt: string;
}

export interface ProcessResult {
  outcome: ProcessOutcome;
  finishedAt: string;
  exitCode: number | null;
  signal: string | null;
  error?: string;
}

export interface ProcessSnapshot {
  taskDir: string;
  request: ProcessRequest;
  phase: ProcessPhase;
  running?: RunningState;
  result?: ProcessResult;
  acknowledgedAt?: string;
}

export interface ProcessInspectionIssue {
  taskDir: string;
  phase: ProcessPhase;
  error: {
    code: "missing_directory" | "missing_request" | "invalid_request";
    message: string;
  };
  running?: RunningState;
  result?: ProcessResult;
  acknowledgedAt?: string;
}

export type ProcessInspection = ProcessSnapshot | ProcessInspectionIssue;

export interface StartProcessOptions {
  taskRoot: string;
  ownerSessionId: string;
  cwd: string;
  spec: ProcessSpec;
  label?: string;
  kind?: string;
  id?: string;
  stdin?: string;
}

const REQUEST_FILE = "request.json";
const RUNNING_FILE = "running.json";
const HEARTBEAT_FILE = "heartbeat.json";
const RESULT_FILE = "result.json";
const ACK_FILE = "acknowledged.json";
const STOP_FILE = "stop-requested.json";
const LAUNCHER_FILE = "launcher.json";
const LOST_AFTER_MS = 30_000;

export function taskPath(taskRoot: string, id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
    throw new Error(`Invalid background process ID: ${id}`);
  }
  return join(taskRoot, id);
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function writeJsonExclusive(path: string, value: unknown): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function isProcessSpec(value: unknown): value is ProcessSpec {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { type?: unknown }).type !== "string"
  ) {
    return false;
  }
  const spec = value as Record<string, unknown>;
  if (spec.type === "shell") {
    return (
      typeof spec.command === "string" &&
      (spec.stdin === undefined || typeof spec.stdin === "string")
    );
  }
  return (
    spec.type === "argv" &&
    typeof spec.executable === "string" &&
    Array.isArray(spec.args) &&
    spec.args.every((arg) => typeof arg === "string") &&
    (spec.stdin === undefined || typeof spec.stdin === "string")
  );
}

function isProcessRequest(value: unknown): value is ProcessRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  return (
    request.version === 1 &&
    typeof request.id === "string" &&
    typeof request.label === "string" &&
    typeof request.kind === "string" &&
    typeof request.ownerSessionId === "string" &&
    typeof request.cwd === "string" &&
    typeof request.createdAt === "string" &&
    isProcessSpec(request.spec)
  );
}

type ProcessRequestRead = { request: ProcessRequest } | { issue: ProcessInspectionIssue["error"] };

async function readProcessRequest(taskDir: string): Promise<ProcessRequestRead> {
  try {
    const request = await readJson<unknown>(join(taskDir, REQUEST_FILE));
    if (request === undefined) {
      return {
        issue: {
          code: "missing_request",
          message: "Background process request is missing.",
        },
      };
    }
    if (!isProcessRequest(request)) {
      return {
        issue: {
          code: "invalid_request",
          message: "Background process request is invalid.",
        },
      };
    }
    return { request };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!(error instanceof SyntaxError) && code !== "EISDIR" && code !== "ENOTDIR") throw error;
    return {
      issue: {
        code: "invalid_request",
        message: "Background process request could not be read.",
      },
    };
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function recordLost(taskDir: string, message: string): Promise<void> {
  await writeJsonExclusive(join(taskDir, RESULT_FILE), {
    outcome: "lost",
    finishedAt: new Date().toISOString(),
    exitCode: null,
    signal: null,
    error: message,
  } satisfies ProcessResult);
}

export async function reconcileProcess(taskDir: string): Promise<void> {
  if (!(await isDirectory(taskDir)) || (await pathExists(join(taskDir, RESULT_FILE)))) return;
  const running = await readJson<RunningState>(join(taskDir, RUNNING_FILE));
  if (running) {
    const heartbeat = await readJson<{ updatedAt: string }>(join(taskDir, HEARTBEAT_FILE));
    const updatedAt = heartbeat ? Date.parse(heartbeat.updatedAt) : Date.parse(running.startedAt);
    if (Date.now() - updatedAt > LOST_AFTER_MS && !isPidAlive(running.supervisorPid)) {
      await recordLost(taskDir, "Background runner disappeared before recording a result.");
    }
    return;
  }

  const requestRead = await readProcessRequest(taskDir);
  const launcher = await readJson<{ pid: number; launchedAt: string }>(
    join(taskDir, LAUNCHER_FILE),
  );
  if ("issue" in requestRead) {
    if (
      !launcher ||
      (Date.now() - Date.parse(launcher.launchedAt) > LOST_AFTER_MS && !isPidAlive(launcher.pid))
    ) {
      await recordLost(taskDir, requestRead.issue.message);
    }
    return;
  }
  if (!launcher) return;
  if (Date.now() - Date.parse(launcher.launchedAt) > LOST_AFTER_MS && !isPidAlive(launcher.pid)) {
    await recordLost(taskDir, "Background runner did not reach the running phase.");
  }
}

export async function inspectProcess(taskDir: string): Promise<ProcessInspection> {
  await reconcileProcess(taskDir);
  const directory = await isDirectory(taskDir);
  const requestRead = directory
    ? await readProcessRequest(taskDir)
    : {
        issue: {
          code: "missing_directory" as const,
          message: "Background process directory is missing.",
        },
      };
  const running = directory ? await readJson<RunningState>(join(taskDir, RUNNING_FILE)) : undefined;
  const result = directory ? await readJson<ProcessResult>(join(taskDir, RESULT_FILE)) : undefined;
  const acknowledged = directory
    ? await readJson<{ acknowledgedAt: string }>(join(taskDir, ACK_FILE))
    : undefined;
  const phase: ProcessPhase = result
    ? acknowledged
      ? "completed"
      : "unchecked"
    : running
      ? "running"
      : "pending";
  if ("issue" in requestRead) {
    return {
      taskDir,
      phase: phase === "pending" ? "unchecked" : phase,
      error: requestRead.issue,
      ...(running ? { running } : {}),
      ...(result ? { result } : {}),
      ...(acknowledged ? { acknowledgedAt: acknowledged.acknowledgedAt } : {}),
    };
  }
  return {
    taskDir,
    request: requestRead.request,
    phase,
    ...(running ? { running } : {}),
    ...(result ? { result } : {}),
    ...(acknowledged ? { acknowledgedAt: acknowledged.acknowledgedAt } : {}),
  };
}

export async function listProcesses(
  taskRoot: string,
  options: { includeCompleted?: boolean } = {},
): Promise<ProcessInspection[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(taskRoot, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const snapshots: ProcessInspection[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const snapshot = await inspectProcess(join(taskRoot, entry.name));
    if (options.includeCompleted || snapshot.phase !== "completed") snapshots.push(snapshot);
  }
  return snapshots.sort((left, right) => {
    const leftCreatedAt = "request" in left ? left.request.createdAt : "";
    const rightCreatedAt = "request" in right ? right.request.createdAt : "";
    return rightCreatedAt.localeCompare(leftCreatedAt) || right.taskDir.localeCompare(left.taskDir);
  });
}

export async function startBackgroundProcess(
  options: StartProcessOptions,
): Promise<ProcessSnapshot> {
  const id = options.id ?? randomUUID();
  const taskDir = taskPath(options.taskRoot, id);
  await mkdir(options.taskRoot, { recursive: true });
  await mkdir(taskDir, { recursive: false });
  const request: ProcessRequest = {
    version: 1,
    id,
    label: options.label?.trim() || id,
    kind: options.kind ?? "command",
    ownerSessionId: options.ownerSessionId,
    cwd: options.cwd,
    createdAt: new Date().toISOString(),
    spec: options.stdin === undefined ? options.spec : { ...options.spec, stdin: options.stdin },
  };
  await writeJsonExclusive(join(taskDir, REQUEST_FILE), request);

  const runnerPath = fileURLToPath(new URL("./runner.mjs", import.meta.url));
  const runner = spawn(process.execPath, [runnerPath, taskDir], {
    detached: true,
    stdio: "ignore",
  });
  runner.unref();
  await atomicWriteJson(join(taskDir, LAUNCHER_FILE), {
    pid: runner.pid,
    launchedAt: new Date().toISOString(),
  });
  const snapshot = await inspectProcess(taskDir);
  if (!("request" in snapshot)) return { ...snapshot, request };
  return snapshot;
}

export async function acknowledgeProcess(taskDir: string): Promise<void> {
  await writeJsonExclusive(join(taskDir, ACK_FILE), { acknowledgedAt: new Date().toISOString() });
}

export async function requestProcessStop(taskDir: string): Promise<ProcessInspection> {
  const snapshot = await inspectProcess(taskDir);
  if (
    !("request" in snapshot) ||
    snapshot.phase === "unchecked" ||
    snapshot.phase === "completed"
  ) {
    return snapshot;
  }
  await writeJsonExclusive(join(taskDir, STOP_FILE), { requestedAt: new Date().toISOString() });
  return inspectProcess(taskDir);
}

export async function readProcessOutput(
  taskDir: string,
): Promise<{ stdout: string; stderr: string }> {
  const read = async (name: string) => {
    try {
      return await readFile(join(taskDir, name), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    }
  };
  const [stdout, stderr] = await Promise.all([read("stdout.log"), read("stderr.log")]);
  return { stdout, stderr };
}
