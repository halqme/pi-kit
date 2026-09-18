import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  taskEvidencePacket,
  type TaskEvidencePacket,
} from "../task/evidence.ts";
import type { JsonValue } from "../../packages/semantic-predicate/src/index.ts";

const exec = promisify(execFile);
const MAX_DIFF_CHARS = 12_000;
const MAX_CONTEXT_CHARS = 9_000;
const MAX_CONTEXT_ITEM_CHARS = 3_000;
const MAX_CONTEXT_ITEMS = 4;

export type ObservationId = "scopeDrift" | "verificationGap" | "consistencyRisk";

export interface ContextExcerpt {
  tool: string;
  paths: string[];
  text: string;
}

export interface ObservationRuntimeEvidence {
  diff?: string;
  context: ContextExcerpt[];
}

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((block) => {
      const item = record(block);
      return item?.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`;
}

function taskView(packet: TaskEvidencePacket): JsonValue {
  const checkpoint = packet.task.latestCheckpoint;
  return {
    goal: packet.task.goal,
    acceptance: packet.task.acceptance,
    status: packet.task.status,
    ...(checkpoint
      ? {
          current_stage: {
            summary: checkpoint.summary,
            ...(checkpoint.completed?.length ? { completed: checkpoint.completed } : {}),
            ...(checkpoint.plan?.length
              ? {
                  working_plan: checkpoint.plan,
                  plan_authority: "hypothesis",
                }
              : {}),
          },
        }
      : {}),
    ...(packet.task.blocker ? { blocker: packet.task.blocker } : {}),
  };
}

function changeView(packet: TaskEvidencePacket, runtime: ObservationRuntimeEvidence): JsonValue {
  const mutations = packet.resources.timeline
    .filter((event) => event.operation === "mutate")
    .map((event) => ({
      path: event.path,
      tool: event.tool,
      ...(event.action ? { action: event.action } : {}),
    }));

  return {
    changed_paths: packet.resources.changedDuringTask,
    recorded_mutations: mutations,
    ...(runtime.diff ? { diff: runtime.diff } : {}),
    provenance: {
      workspace_delta: packet.resources.coverage.workspaceDelta,
      explicit_mutation_tracking: packet.resources.coverage.mutations,
      opaque_tool_effects: packet.resources.coverage.opaqueToolEffects,
    },
  };
}

function verificationView(packet: TaskEvidencePacket): JsonValue {
  return packet.verification
    .filter((item) => item.origin === "executed")
    .map((item) => ({
      provenance: item.provenance,
      passed: item.passed,
      summary: item.summary,
      ...(item.detail ? { detail: clip(item.detail, 2_000) } : {}),
    }));
}

function repositoryEvidenceView(
  packet: TaskEvidencePacket,
  runtime: ObservationRuntimeEvidence,
): JsonValue {
  return {
    observed_paths: packet.resources.observed,
    excerpts: runtime.context.map((item) => ({
      tool: item.tool,
      paths: item.paths,
      text: item.text,
    })),
    provenance: {
      explicit_observation_tracking: packet.resources.coverage.observations,
      note: "Excerpts are successful read/context tool results previously observed during this task.",
    },
  };
}

export function projectObservationState(
  observation: ObservationId,
  packet: TaskEvidencePacket,
  runtime: ObservationRuntimeEvidence,
): JsonValue {
  if (observation === "scopeDrift") {
    return {
      task: taskView(packet),
      changes: changeView(packet, runtime),
    };
  }

  if (observation === "verificationGap") {
    return {
      task: taskView(packet),
      changes: changeView(packet, runtime),
      verification: verificationView(packet),
    };
  }

  return {
    changes: changeView(packet, runtime),
    repository_evidence: repositoryEvidenceView(packet, runtime),
  };
}

async function diffEvidence(
  ctx: ExtensionContext,
  packet: TaskEvidencePacket,
): Promise<string | undefined> {
  const paths = packet.resources.changedDuringTask;
  const baseline = packet.workspace?.baselineHead;
  if (!baseline || paths.length === 0) return undefined;

  try {
    const { stdout } = await exec(
      "git",
      ["--no-pager", "diff", "--no-ext-diff", "--unified=2", baseline, "--", ...paths],
      {
        cwd: ctx.cwd,
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        timeout: 10_000,
      },
    );
    const diff = stdout.trim();
    return diff ? clip(diff, MAX_DIFF_CHARS) : undefined;
  } catch {
    return undefined;
  }
}

function toolResultText(entries: unknown[]): Map<string, { tool: string; text: string }> {
  const results = new Map<string, { tool: string; text: string }>();

  for (const candidate of entries) {
    const entry = record(candidate);
    if (entry?.type !== "message") continue;
    const message = record(entry.message);
    if (message?.role !== "toolResult" || message.isError === true) continue;
    const id = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
    const tool = typeof message.toolName === "string" ? message.toolName : undefined;
    if (!id || !tool) continue;
    const text = textContent(message.content).trim();
    if (text) results.set(id, { tool, text });
  }

  return results;
}

function contextEvidence(
  ctx: ExtensionContext,
  packet: TaskEvidencePacket,
): ContextExcerpt[] {
  const results = toolResultText(ctx.sessionManager.getEntries());
  const changed = new Set(packet.resources.changedDuringTask);
  const grouped = new Map<
    string,
    { tool: string; paths: Set<string>; index: number; overlapsChange: boolean }
  >();

  packet.resources.timeline.forEach((event, index) => {
    if (event.operation !== "observe" || (event.tool !== "read" && event.tool !== "context")) {
      return;
    }
    const existing = grouped.get(event.toolCallId);
    if (existing) {
      existing.paths.add(event.path);
      existing.overlapsChange ||= changed.has(event.path);
      existing.index = index;
      return;
    }
    grouped.set(event.toolCallId, {
      tool: event.tool,
      paths: new Set([event.path]),
      index,
      overlapsChange: changed.has(event.path),
    });
  });

  const candidates = [...grouped.entries()]
    .map(([toolCallId, value]) => ({ toolCallId, ...value }))
    .filter((item) => results.has(item.toolCallId))
    .sort((a, b) => {
      if (a.overlapsChange !== b.overlapsChange) return a.overlapsChange ? -1 : 1;
      return b.index - a.index;
    })
    .slice(0, MAX_CONTEXT_ITEMS);

  let remaining = MAX_CONTEXT_CHARS;
  const excerpts: ContextExcerpt[] = [];
  for (const item of candidates) {
    if (remaining <= 0) break;
    const result = results.get(item.toolCallId);
    if (!result) continue;
    const text = clip(result.text, Math.min(MAX_CONTEXT_ITEM_CHARS, remaining));
    remaining -= text.length;
    excerpts.push({
      tool: item.tool,
      paths: [...item.paths].sort(),
      text,
    });
  }
  return excerpts;
}

export async function buildObservationState(
  ctx: ExtensionContext,
  observation: ObservationId,
): Promise<JsonValue> {
  const packet = await taskEvidencePacket(ctx);
  if (!packet || (packet.task.status !== "active" && packet.task.status !== "blocked")) {
    throw new Error("precondition: semantic_observe requires an active or blocked task.");
  }

  const [diff, context] = await Promise.all([
    diffEvidence(ctx, packet),
    Promise.resolve(contextEvidence(ctx, packet)),
  ]);

  return projectObservationState(observation, packet, { diff, context });
}
