import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  acknowledgeProcess,
  atomicWriteJson,
  inspectProcess,
  requestProcessStop,
  startBackgroundProcess,
  taskPath,
  type ProcessSnapshot,
} from "@halqme/background_process";
import { agentTeamTaskRoot, createPiAgentFactory } from "./pi-runner.ts";
import { AGENT_TEAM_TOOL_NAMES } from "./policy.ts";
import {
  AgentTeam,
  type AgentTeamConfig,
  type AgentTeamMemberConfig,
  type AgentTeamSnapshot,
  formatAgentTeam,
  type PersistedAgentTeam,
} from "./team.ts";

const AGENT_TEAM_STATE_ENTRY = "agent-team-state";
const AGENT_TEAM_STATE_PREFIX = ".team-";
const WORKER_PATH = fileURLToPath(new URL("./worker.ts", import.meta.url));

interface PersistedAgentTeamRuntime {
  operationId: string;
  cwd: string;
}

interface AgentTeamStateEntry extends PersistedAgentTeam {
  agentTeamRuntime?: PersistedAgentTeamRuntime;
}

export interface AgentTeamJob {
  team: AgentTeam;
  runtime?: PersistedAgentTeamRuntime;
}

export type AgentTeamJobOperation =
  | { action: "start" }
  | { action: "answer"; answer: string }
  | { action: "revisit"; topic: string };

interface AgentTeamWorkerRequest {
  version: 1;
  taskDir: string;
  statePath: string;
  sessionDir: string;
  sessionId: string;
  cwd: string;
  config: AgentTeamConfig;
  operation: AgentTeamJobOperation;
  initial?: PersistedAgentTeam;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSafeOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function parseRuntime(value: unknown): PersistedAgentTeamRuntime | undefined {
  if (!isRecord(value)) return undefined;
  if (!isSafeOperationId(value.operationId) || typeof value.cwd !== "string") return undefined;
  return { operationId: value.operationId, cwd: value.cwd };
}

function createAgentFactory(
  ctx: ExtensionContext,
  state: Pick<PersistedAgentTeam, "model" | "tools" | "thinking" | "timeoutMs"> | AgentTeamConfig,
  cwd = ctx.cwd,
) {
  return createPiAgentFactory({
    cwd,
    taskRoot: agentTeamTaskRoot(
      ctx.sessionManager.getSessionDir(),
      ctx.sessionManager.getSessionId(),
    ),
    ownerSessionId: ctx.sessionManager.getSessionId(),
    ...(state.model !== undefined ? { model: state.model } : {}),
    tools: state.tools ?? [...AGENT_TEAM_TOOL_NAMES],
    ...(state.thinking !== undefined ? { thinking: state.thinking } : {}),
    timeoutMs: state.timeoutMs ?? 300_000,
  });
}

function configFromSnapshot(snapshot: AgentTeamSnapshot): AgentTeamConfig {
  const members: AgentTeamMemberConfig[] = snapshot.members.map((member) => ({
    name: member.name,
    role: member.role,
    ...(member.instructionPolicy ? { instructionPolicy: member.instructionPolicy } : {}),
    ...(member.model !== undefined ? { model: member.model } : {}),
    ...(member.skills !== undefined ? { skills: [...member.skills] } : {}),
  }));
  return {
    id: snapshot.id,
    topic: snapshot.topic,
    mode: snapshot.mode,
    interaction: snapshot.interaction,
    members,
    maxRounds: snapshot.maxRounds,
    ...(snapshot.model !== undefined ? { model: snapshot.model } : {}),
    tools: [...snapshot.tools],
    ...(snapshot.thinking !== undefined ? { thinking: snapshot.thinking } : {}),
    ...(snapshot.timeoutMs !== undefined ? { timeoutMs: snapshot.timeoutMs } : {}),
  };
}

function createShadowTeam(
  ctx: ExtensionContext,
  snapshot: AgentTeamSnapshot,
  cwd = ctx.cwd,
): AgentTeam {
  return new AgentTeam(
    configFromSnapshot(snapshot),
    createAgentFactory(ctx, snapshot, cwd),
    snapshot,
  );
}

function statePathFor(root: string, teamId: string): string {
  return join(root, `${AGENT_TEAM_STATE_PREFIX}${encodeURIComponent(teamId)}.json`);
}

function pathsFor(
  ctx: ExtensionContext,
  job: AgentTeamJob,
):
  | {
      root: string;
      taskDir: string;
      statePath: string;
    }
  | undefined {
  if (!job.runtime) return undefined;
  const root = agentTeamTaskRoot(
    ctx.sessionManager.getSessionDir(),
    ctx.sessionManager.getSessionId(),
  );
  return {
    root,
    taskDir: taskPath(root, job.runtime.operationId),
    statePath: statePathFor(root, job.team.snapshot().id),
  };
}

function startingSnapshot(snapshot: AgentTeamSnapshot): AgentTeamSnapshot {
  const {
    consultation: _consultation,
    finalAnswer: _finalAnswer,
    error: _error,
    ...rest
  } = snapshot;
  return { ...rest, status: "starting" };
}

function failedSnapshot(snapshot: AgentTeamSnapshot, error: string): AgentTeamSnapshot {
  return { ...snapshot, status: "failed", error };
}

function stoppedSnapshot(snapshot: AgentTeamSnapshot): AgentTeamSnapshot {
  return { ...snapshot, status: "stopped" };
}

function snapshotChanged(left: AgentTeamSnapshot, right: AgentTeamSnapshot): boolean {
  return JSON.stringify(left) !== JSON.stringify(right);
}

async function readTeamState(path: string): Promise<PersistedAgentTeam | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed) || typeof parsed.id !== "string") return undefined;
    return parsed as unknown as PersistedAgentTeam;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function createAgentTeamJob(
  ctx: ExtensionContext,
  config: AgentTeamConfig,
  initial?: Partial<AgentTeamSnapshot>,
): AgentTeamJob {
  return {
    team: new AgentTeam(config, createAgentFactory(ctx, config), initial),
  };
}

export function summarizeAgentTeamJobs(jobs: Map<string, AgentTeamJob>): AgentTeamSnapshot[] {
  return [...jobs.values()].map((job) => job.team.snapshot());
}

export function appendAgentTeamState(pi: ExtensionAPI, job: AgentTeamJob): void {
  const state = job.team.persisted();
  const data: AgentTeamStateEntry = job.runtime
    ? { ...state, agentTeamRuntime: { ...job.runtime } }
    : state;
  pi.appendEntry(AGENT_TEAM_STATE_ENTRY, data);
}

export function restoreAgentTeamJobs(ctx: ExtensionContext, jobs: Map<string, AgentTeamJob>): void {
  jobs.clear();
  const restored = new Map<string, AgentTeamJob>();
  for (const entry of [...ctx.sessionManager.getEntries()].reverse()) {
    if (!isRecord(entry)) continue;
    if (entry.type !== "custom" || entry.customType !== AGENT_TEAM_STATE_ENTRY) continue;
    const data = entry.data;
    if (!isRecord(data) || typeof data.id !== "string" || restored.has(data.id)) continue;
    try {
      const state = data as unknown as PersistedAgentTeam;
      const team = AgentTeam.fromPersisted(state, createAgentFactory(ctx, state));
      const runtime = parseRuntime(data.agentTeamRuntime);
      restored.set(data.id, { team, ...(runtime ? { runtime } : {}) });
    } catch {
      // Ignore malformed historical entries without affecting the live session.
    }
  }
  for (const [id, job] of restored) jobs.set(id, job);
}

export async function launchAgentTeamWorker(
  ctx: ExtensionContext,
  job: AgentTeamJob,
  operation: AgentTeamJobOperation,
): Promise<ProcessSnapshot> {
  const before = job.team.snapshot();
  const initial = operation.action === "start" ? undefined : job.team.persisted();
  const cwd = job.runtime?.cwd ?? ctx.cwd;
  if (operation.action !== "start") {
    job.team = createShadowTeam(ctx, startingSnapshot(before), cwd);
  }

  const operationId = operation.action === "start" ? before.id : `${before.id}-${randomUUID()}`;
  job.runtime = { operationId, cwd };
  const paths = pathsFor(ctx, job);
  if (!paths) throw new Error("agent-team worker paths are unavailable");
  await atomicWriteJson(paths.statePath, job.team.persisted());

  const request: AgentTeamWorkerRequest = {
    version: 1,
    taskDir: paths.taskDir,
    statePath: paths.statePath,
    sessionDir: ctx.sessionManager.getSessionDir(),
    sessionId: ctx.sessionManager.getSessionId(),
    cwd,
    config: configFromSnapshot(before),
    operation,
    ...(initial ? { initial } : {}),
  };

  try {
    return await startBackgroundProcess({
      taskRoot: paths.root,
      ownerSessionId: ctx.sessionManager.getSessionId(),
      cwd,
      id: operationId,
      kind: "agent-team",
      label: `agent-team/${before.id}`,
      spec: {
        type: "argv",
        executable: process.execPath,
        args: [WORKER_PATH],
        stdin: `${JSON.stringify(request)}\n`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    job.team = createShadowTeam(ctx, failedSnapshot(job.team.snapshot(), message), cwd);
    await atomicWriteJson(paths.statePath, job.team.persisted());
    throw error;
  }
}

async function refreshAgentTeamJob(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  job: AgentTeamJob,
  notify: boolean,
): Promise<{ changed: boolean }> {
  const paths = pathsFor(ctx, job);
  if (!paths) return { changed: false };

  let processSnapshot: ProcessSnapshot;
  try {
    processSnapshot = await inspectProcess(paths.taskDir);
  } catch (error) {
    if (!isMissingFile(error)) return { changed: false };
    const current = job.team.snapshot();
    if (
      current.status === "completed" ||
      current.status === "failed" ||
      current.status === "stopped"
    ) {
      return { changed: false };
    }
    job.team = createShadowTeam(
      ctx,
      failedSnapshot(current, "agent-team worker record is unavailable"),
      job.runtime?.cwd ?? ctx.cwd,
    );
    return { changed: true };
  }

  let changed = false;
  const persisted = await readTeamState(paths.statePath);
  if (persisted && persisted.id === job.team.snapshot().id) {
    const current = job.team.snapshot();
    if (snapshotChanged(current, persisted)) {
      job.team = createShadowTeam(ctx, persisted, job.runtime?.cwd ?? ctx.cwd);
      changed = true;
    }
  }

  const outcome = processSnapshot.result?.outcome;
  const processFinished = processSnapshot.phase === "unchecked";
  if (processFinished) {
    const current = job.team.snapshot();
    if (outcome === "failed" || outcome === "lost") {
      if (current.status !== "failed") {
        job.team = createShadowTeam(
          ctx,
          failedSnapshot(current, processSnapshot.result?.error ?? "agent-team worker failed"),
          job.runtime?.cwd ?? ctx.cwd,
        );
        changed = true;
      }
    } else if (outcome === "stopped") {
      if (current.status !== "stopped" && current.status !== "completed") {
        job.team = createShadowTeam(ctx, stoppedSnapshot(current), job.runtime?.cwd ?? ctx.cwd);
        changed = true;
      }
    } else if (current.status === "starting" || current.status === "running") {
      job.team = createShadowTeam(
        ctx,
        failedSnapshot(current, "agent-team worker exited without a final state"),
        job.runtime?.cwd ?? ctx.cwd,
      );
      changed = true;
    }

    if (notify) {
      const snapshot = job.team.snapshot();
      pi.sendMessage(
        {
          customType: "agent-team-status",
          content: `[agent-team] ${snapshot.status}\n\n${formatAgentTeam(snapshot)}`,
          display: true,
          details: snapshot,
        },
        snapshot.status === "awaiting-user"
          ? { triggerTurn: false, deliverAs: "nextTurn" }
          : { triggerTurn: true, deliverAs: "followUp" },
      );
      await acknowledgeProcess(paths.taskDir);
    }
  }

  return { changed };
}

export async function refreshAgentTeamJobs(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  jobs: Map<string, AgentTeamJob>,
  options: { notify?: boolean } = {},
): Promise<void> {
  for (const job of jobs.values()) {
    const result = await refreshAgentTeamJob(pi, ctx, job, options.notify ?? false);
    if (result.changed) appendAgentTeamState(pi, job);
  }
}

export async function stopAgentTeamJob(
  ctx: ExtensionContext,
  job: AgentTeamJob,
): Promise<AgentTeamSnapshot> {
  const current = job.team.snapshot();
  if (
    current.status === "completed" ||
    current.status === "failed" ||
    current.status === "stopped"
  ) {
    return current;
  }

  const paths = pathsFor(ctx, job);
  if (paths) {
    try {
      await requestProcessStop(paths.taskDir);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }
  job.team = createShadowTeam(ctx, stoppedSnapshot(current), job.runtime?.cwd ?? ctx.cwd);
  if (paths) await atomicWriteJson(paths.statePath, job.team.persisted());
  return job.team.snapshot();
}
