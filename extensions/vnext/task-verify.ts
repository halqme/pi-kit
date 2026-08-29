import { randomUUID } from "node:crypto";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { jsonResult } from "./shared.ts";

const TASK_ENTRY = "vnext-task-state";
const VERIFY_ENTRY = "vnext-verification-evidence";

const strongProvenance = new Set<Provenance>([
  "existing_test",
  "existing_ci",
  "compiler",
  "typecheck",
  "linter",
  "user",
  "structural_audit",
]);

const provenanceSchema = Type.Union([
  Type.Literal("existing_test"),
  Type.Literal("existing_ci"),
  Type.Literal("compiler"),
  Type.Literal("typecheck"),
  Type.Literal("linter"),
  Type.Literal("user"),
  Type.Literal("structural_audit"),
  Type.Literal("self_test"),
  Type.Literal("self_review"),
  Type.Literal("review_agent"),
  Type.Literal("other"),
]);

type Provenance =
  | "existing_test"
  | "existing_ci"
  | "compiler"
  | "typecheck"
  | "linter"
  | "user"
  | "structural_audit"
  | "self_test"
  | "self_review"
  | "review_agent"
  | "other";

interface TaskCheckpoint {
  at: string;
  summary: string;
  plan?: string[];
  observations?: string[];
  completed?: string[];
}

interface TaskState {
  version: 1;
  id: string;
  goal: string;
  acceptance: string[];
  status: "active" | "blocked" | "done" | "stopped";
  checkpoints: TaskCheckpoint[];
  blocker?: string;
  completionSummary?: string;
  createdAt: string;
  updatedAt: string;
}

interface VerificationEvidence {
  id: string;
  taskId?: string;
  provenance: Provenance;
  passed: boolean;
  summary: string;
  detail?: string;
  at: string;
}

function latestCustom<T>(ctx: ExtensionContext, customType: string): T | undefined {
  for (const candidate of [...ctx.sessionManager.getEntries()].reverse()) {
    if (!candidate || typeof candidate !== "object") continue;
    const entry = candidate as { type?: unknown; customType?: unknown; data?: unknown };
    if (entry.type === "custom" && entry.customType === customType) return entry.data as T;
  }
  return undefined;
}

function customEntries<T>(ctx: ExtensionContext, customType: string): T[] {
  return ctx.sessionManager.getEntries().flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const entry = candidate as { type?: unknown; customType?: unknown; data?: unknown };
    return entry.type === "custom" && entry.customType === customType ? [entry.data as T] : [];
  });
}

export function registerVerification(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "verify",
    label: "Verify",
    description:
      "Record and assess verification evidence with provenance. Existing tests, CI, compilers, typecheckers, linters, user acceptance, and structural audits are strong external evidence; agent-authored tests and self-review remain supporting signals.",
    parameters: Type.Union([
      Type.Object({
        action: Type.Literal("record"),
        provenance: provenanceSchema,
        passed: Type.Boolean(),
        summary: Type.String({ minLength: 1 }),
        detail: Type.Optional(Type.String()),
        taskId: Type.Optional(Type.String()),
      }),
      Type.Object({ action: Type.Literal("assess"), taskId: Type.Optional(Type.String()) }),
    ]),
    async execute(_id, params, _signal, _update, ctx) {
      const task = latestCustom<TaskState>(ctx, TASK_ENTRY);
      const taskId = params.taskId ?? task?.id;
      if (params.action === "record") {
        const evidence: VerificationEvidence = {
          id: randomUUID(),
          ...(taskId ? { taskId } : {}),
          provenance: params.provenance,
          passed: params.passed,
          summary: params.summary.trim(),
          ...(params.detail?.trim() ? { detail: params.detail.trim() } : {}),
          at: new Date().toISOString(),
        };
        pi.appendEntry(VERIFY_ENTRY, evidence);
        return jsonResult({ recorded: evidence });
      }
      const evidence = customEntries<VerificationEvidence>(ctx, VERIFY_ENTRY).filter(
        (item) => !taskId || item.taskId === taskId,
      );
      const strong = evidence.filter((item) => strongProvenance.has(item.provenance));
      const supporting = evidence.filter((item) => !strongProvenance.has(item.provenance));
      return jsonResult({
        taskId: taskId ?? null,
        strong: {
          passed: strong.filter((item) => item.passed).length,
          failed: strong.filter((item) => !item.passed).length,
        },
        supporting: {
          passed: supporting.filter((item) => item.passed).length,
          failed: supporting.filter((item) => !item.passed).length,
        },
        evidence,
      });
    },
  });
}

export function registerTask(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "task",
    label: "Task",
    description:
      "Maintain one adaptive task as goal, disposable plan, observations, checkpoints, blockers, and evidence-backed completion. Planning is optional and revisable; completion requires strong verification evidence recorded through verify.",
    promptGuidelines: [
      "Ground the repository before committing to a detailed plan; plans are hypotheses and may be replaced as observations change.",
      "Use checkpoint when the current plan or understanding materially changes, not after every tool call.",
      "Do not finish solely because planned steps were executed. Compare the requested outcome with the workspace and strong verification evidence.",
    ],
    parameters: Type.Union([
      Type.Object({
        action: Type.Literal("start"),
        goal: Type.String({ minLength: 1 }),
        acceptance: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 20 })),
      }),
      Type.Object({
        action: Type.Literal("checkpoint"),
        summary: Type.String({ minLength: 1 }),
        plan: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 20 })),
        observations: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 20 })),
        completed: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 20 })),
      }),
      Type.Object({ action: Type.Literal("block"), reason: Type.String({ minLength: 1 }) }),
      Type.Object({ action: Type.Literal("resume"), summary: Type.Optional(Type.String()) }),
      Type.Object({ action: Type.Literal("status") }),
      Type.Object({ action: Type.Literal("finish"), summary: Type.String({ minLength: 1 }) }),
      Type.Object({ action: Type.Literal("stop"), reason: Type.String({ minLength: 1 }) }),
    ]),
    async execute(_id, params, _signal, _update, ctx) {
      const current = latestCustom<TaskState>(ctx, TASK_ENTRY);
      if (params.action === "status") return jsonResult(current ?? { status: "none" });

      if (params.action === "start") {
        if (current && (current.status === "active" || current.status === "blocked")) {
          throw new Error(`Task '${current.id}' is still ${current.status}; finish or stop it first.`);
        }
        const now = new Date().toISOString();
        const state: TaskState = {
          version: 1,
          id: randomUUID(),
          goal: params.goal.trim(),
          acceptance: (params.acceptance ?? []).map((item) => item.trim()),
          status: "active",
          checkpoints: [],
          createdAt: now,
          updatedAt: now,
        };
        pi.appendEntry(TASK_ENTRY, state);
        return jsonResult(state);
      }

      if (!current) throw new Error("No task state. Start a task first.");
      const state: TaskState = { ...current, checkpoints: [...current.checkpoints] };
      const now = new Date().toISOString();

      if (params.action === "checkpoint") {
        if (state.status !== "active") throw new Error(`Task is ${state.status}, not active.`);
        state.checkpoints.push({
          at: now,
          summary: params.summary.trim(),
          ...(params.plan?.length ? { plan: params.plan.map((item) => item.trim()) } : {}),
          ...(params.observations?.length
            ? { observations: params.observations.map((item) => item.trim()) }
            : {}),
          ...(params.completed?.length
            ? { completed: params.completed.map((item) => item.trim()) }
            : {}),
        });
      } else if (params.action === "block") {
        if (state.status !== "active") throw new Error(`Task is ${state.status}, not active.`);
        state.status = "blocked";
        state.blocker = params.reason.trim();
      } else if (params.action === "resume") {
        if (state.status !== "blocked") throw new Error(`Task is ${state.status}, not blocked.`);
        state.status = "active";
        delete state.blocker;
        if (params.summary?.trim()) state.checkpoints.push({ at: now, summary: params.summary.trim() });
      } else if (params.action === "stop") {
        if (state.status === "done" || state.status === "stopped") {
          throw new Error(`Task is already ${state.status}.`);
        }
        state.status = "stopped";
        state.completionSummary = params.reason.trim();
      } else if (params.action === "finish") {
        if (state.status !== "active") throw new Error(`Task is ${state.status}, not active.`);
        const evidence = customEntries<VerificationEvidence>(ctx, VERIFY_ENTRY).filter(
          (item) => item.taskId === state.id,
        );
        const latestStrong = new Map<Provenance, VerificationEvidence>();
        for (const item of evidence) {
          if (strongProvenance.has(item.provenance)) latestStrong.set(item.provenance, item);
        }
        if (![...latestStrong.values()].some((item) => item.passed)) {
          throw new Error(
            "Strong verification evidence is required before task.finish. Run the relevant existing checks or structural audit, then record the result with verify.record.",
          );
        }
        const failures = [...latestStrong.values()].filter((item) => !item.passed);
        if (failures.length > 0) {
          throw new Error(
            `Strong verification still has failing evidence: ${failures
              .map((item) => `${item.provenance}: ${item.summary}`)
              .join("; ")}`,
          );
        }
        state.status = "done";
        state.completionSummary = params.summary.trim();
      }

      state.updatedAt = now;
      pi.appendEntry(TASK_ENTRY, state);
      return jsonResult(state);
    },
  });
}
