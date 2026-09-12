import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { customEntries, latestCustom, TASK_ENTRY } from "./shared.ts";

export const RESOURCE_ENTRY = "task-resource-event";
export const WORKSPACE_ENTRY = "task-workspace-baseline";

const exec = promisify(execFile);
const trackedTools = new Set(["read", "edit", "write", "context", "code"]);

export interface TaskResourceEvent {
  version: 1;
  id: string;
  taskId: string;
  operation: "observe" | "mutate";
  path: string;
  tool: string;
  action?: string;
  toolCallId: string;
  assistantEntryId?: string;
  at: string;
}

interface WorkspaceFileState {
  path: string;
  digest: string | null;
}

export interface TaskWorkspaceBaseline {
  version: 1;
  taskId: string;
  kind: "git";
  root: string;
  head?: string;
  dirty: WorkspaceFileState[];
  at: string;
}

export interface TaskReviewResources {
  observed: string[];
  mutated: string[];
  changedDuringTask: string[];
  preexistingDirty: string[];
  timeline: Array<{
    operation: "observe" | "mutate";
    path: string;
    tool: string;
    action?: string;
    assistantEntryId?: string;
  }>;
  coverage: {
    observations: "explicit-tools";
    mutations: "explicit-tools";
    workspaceDelta: "git" | "unavailable";
    opaqueToolEffects: "not-attributed";
  };
}

type TaskRef = { id: string; status: string };
type Capture = { operation: "observe" | "mutate"; path: string; action?: string };

type PendingCall = { assistantEntryId?: string };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalized(path: string): string {
  return path.replaceAll("\\", "/");
}

function pathWithin(cwd: string, rawPath: string): string | undefined {
  const absolute = resolve(cwd, rawPath);
  const fromRoot = relative(cwd, absolute);
  if (!fromRoot || fromRoot.startsWith("..") || isAbsolute(fromRoot)) return undefined;
  return normalized(fromRoot);
}

function parseJsonContent(content: unknown): Record<string, unknown> | undefined {
  for (const block of array(content)) {
    const item = record(block);
    if (item?.type !== "text" || typeof item.text !== "string") continue;
    try {
      const parsed = JSON.parse(item.text) as unknown;
      const value = record(parsed);
      if (value) return value;
    } catch {
      // Non-JSON tool output is not structured provenance.
    }
  }
  return undefined;
}

function addPath(target: Set<string>, value: unknown): void {
  const path = string(value);
  if (path) target.add(path);
}

function structuralPaths(response: Record<string, unknown> | undefined): string[] {
  if (!response) return [];
  const paths = new Set<string>();
  for (const item of array(response.handles)) addPath(paths, record(item)?.path);
  const data = record(response.data);
  for (const item of array(data?.candidates)) addPath(paths, record(item)?.path);
  for (const item of array(data?.sources)) addPath(paths, record(item)?.path);
  for (const item of array(data?.paths)) addPath(paths, item);
  return [...paths];
}

function capturesForTool(
  toolName: string,
  input: Record<string, unknown>,
  content: unknown,
  details: unknown,
  cwd: string,
): Capture[] {
  const captures: Capture[] = [];
  const action = string(input.action);
  const push = (operation: Capture["operation"], rawPath: unknown) => {
    const value = string(rawPath);
    if (!value) return;
    const path = pathWithin(cwd, value);
    if (!path) return;
    captures.push({ operation, path, ...(action ? { action } : {}) });
  };

  if (toolName === "read") push("observe", input.path);
  if (toolName === "edit" || toolName === "write") push("mutate", input.path);

  if (toolName === "context") {
    if (action === "find") {
      const search = record(details);
      for (const result of array(search?.results)) push("observe", record(result)?.path);
    }
    if (action === "inspect") push("observe", input.path);
    for (const path of structuralPaths(parseJsonContent(content))) push("observe", path);
  }

  if (toolName === "code") {
    push("mutate", input.path);
    for (const path of structuralPaths(parseJsonContent(content))) push("mutate", path);
  }

  const seen = new Set<string>();
  return captures.filter((capture) => {
    const key = `${capture.operation}\u0000${capture.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function activeTask(ctx: ExtensionContext): TaskRef | undefined {
  const task = latestCustom<TaskRef>(ctx, TASK_ENTRY);
  return task?.status === "active" ? task : undefined;
}

export function registerTaskResourceTracking(pi: ExtensionAPI): void {
  const pending = new Map<string, PendingCall>();

  pi.on("tool_call", async (event, ctx) => {
    if (!trackedTools.has(event.toolName)) return undefined;
    const assistantEntryId = ctx.sessionManager.getLeafId();
    pending.set(event.toolCallId, assistantEntryId ? { assistantEntryId } : {});
    return undefined;
  });

  pi.on("tool_result", async (event, ctx) => {
    const call = pending.get(event.toolCallId);
    pending.delete(event.toolCallId);
    if (event.isError || !trackedTools.has(event.toolName)) return undefined;
    const task = activeTask(ctx);
    if (!task) return undefined;

    for (const capture of capturesForTool(
      event.toolName,
      event.input,
      event.content,
      event.details,
      ctx.cwd,
    )) {
      const resource: TaskResourceEvent = {
        version: 1,
        id: randomUUID(),
        taskId: task.id,
        operation: capture.operation,
        path: capture.path,
        tool: event.toolName,
        ...(capture.action ? { action: capture.action } : {}),
        toolCallId: event.toolCallId,
        ...(call?.assistantEntryId ? { assistantEntryId: call.assistantEntryId } : {}),
        at: new Date().toISOString(),
      };
      pi.appendEntry(RESOURCE_ENTRY, resource);
    }
    return undefined;
  });
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10_000,
  });
  return stdout;
}

function nulPaths(output: string): string[] {
  return output
    .split("\u0000")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalized);
}

async function dirtyPaths(root: string): Promise<string[]> {
  const [unstaged, staged, untracked] = await Promise.all([
    git(root, ["diff", "--name-only", "-z", "--"]),
    git(root, ["diff", "--cached", "--name-only", "-z", "--"]),
    git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  return [...new Set([...nulPaths(unstaged), ...nulPaths(staged), ...nulPaths(untracked)])].sort();
}

async function fileDigest(root: string, path: string): Promise<string | null> {
  try {
    return (await git(root, ["hash-object", "--no-filters", "--", path])).trim() || null;
  } catch {
    return null;
  }
}

export async function captureWorkspaceBaseline(
  cwd: string,
  taskId: string,
): Promise<TaskWorkspaceBaseline | undefined> {
  let root: string;
  try {
    root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
  } catch {
    return undefined;
  }
  if (!root) return undefined;

  const head = await git(root, ["rev-parse", "HEAD"])
    .then((value) => value.trim() || undefined)
    .catch(() => undefined);
  const dirty = await dirtyPaths(root);
  const states = await Promise.all(
    dirty.map(async (path) => ({ path, digest: await fileDigest(root, path) })),
  );
  return {
    version: 1,
    taskId,
    kind: "git",
    root,
    ...(head ? { head } : {}),
    dirty: states,
    at: new Date().toISOString(),
  };
}

function displayPath(cwd: string, root: string, path: string): string | undefined {
  return pathWithin(cwd, resolve(root, path));
}

async function changedSinceBaseline(
  cwd: string,
  baseline: TaskWorkspaceBaseline,
): Promise<string[]> {
  const currentRoot = await git(cwd, ["rev-parse", "--show-toplevel"])
    .then((value) => value.trim())
    .catch(() => "");
  if (!currentRoot || resolve(currentRoot) !== resolve(baseline.root)) return [];

  const candidates = new Set<string>();
  if (baseline.head) {
    for (const path of nulPaths(
      await git(baseline.root, ["diff", baseline.head, "--name-only", "-z", "--"]),
    )) {
      candidates.add(path);
    }
    for (const path of nulPaths(
      await git(baseline.root, ["ls-files", "--others", "--exclude-standard", "-z"]),
    )) {
      candidates.add(path);
    }
  } else {
    for (const path of await dirtyPaths(baseline.root)) candidates.add(path);
  }
  for (const file of baseline.dirty) candidates.add(file.path);

  const initial = new Map(baseline.dirty.map((file) => [file.path, file.digest]));
  const changed: string[] = [];
  for (const path of [...candidates].sort()) {
    if (initial.has(path)) {
      const current = await fileDigest(baseline.root, path);
      if (current === initial.get(path)) continue;
    }
    const display = displayPath(cwd, baseline.root, path);
    if (display) changed.push(display);
  }
  return changed;
}

function uniquePaths(events: TaskResourceEvent[], operation: TaskResourceEvent["operation"]): string[] {
  return [...new Set(events.filter((event) => event.operation === operation).map((event) => event.path))].sort();
}

export async function taskReviewResources(
  ctx: ExtensionContext,
  taskId: string,
): Promise<TaskReviewResources> {
  const events = customEntries<TaskResourceEvent>(ctx, RESOURCE_ENTRY).filter(
    (event) => event.taskId === taskId,
  );
  const baseline = [...customEntries<TaskWorkspaceBaseline>(ctx, WORKSPACE_ENTRY)]
    .reverse()
    .find((item) => item.taskId === taskId);
  const changedDuringTask = baseline
    ? await changedSinceBaseline(ctx.cwd, baseline).catch(() => [])
    : uniquePaths(events, "mutate");
  const preexistingDirty = baseline
    ? baseline.dirty.flatMap((file) => {
        const path = displayPath(ctx.cwd, baseline.root, file.path);
        return path ? [path] : [];
      })
    : [];

  return {
    observed: uniquePaths(events, "observe"),
    mutated: uniquePaths(events, "mutate"),
    changedDuringTask,
    preexistingDirty: [...new Set(preexistingDirty)].sort(),
    timeline: events.map((event) => ({
      operation: event.operation,
      path: event.path,
      tool: event.tool,
      ...(event.action ? { action: event.action } : {}),
      ...(event.assistantEntryId ? { assistantEntryId: event.assistantEntryId } : {}),
    })),
    coverage: {
      observations: "explicit-tools",
      mutations: "explicit-tools",
      workspaceDelta: baseline ? "git" : "unavailable",
      opaqueToolEffects: "not-attributed",
    },
  };
}
