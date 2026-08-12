import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  emptyPlan,
  recordProgress,
  remainingSteps,
  restorePlanState,
  savePlanState,
  type PlanState,
} from "@halqme/plan-state";
import { supervise, type SupervisionDecision } from "@halqme/protocol-supervision";
import { loopController } from "../loop/control.ts";
import { runnerSupervisors, type RunnerProposal, type RunnerProtocolContext } from "./protocol.ts";

function taskFor(state: PlanState): string {
  const remaining = remainingSteps(state);
  if (!remaining.length)
    return [
      "All approved TODO steps are reported complete.",
      "Apply assess-task-completion to evaluate the requested outcome against the actual workspace and available evidence.",
      "Do not infer completion from the empty TODO list alone.",
      "Call runner.finish with a concise evidence summary only when completion is supported; otherwise continue working or call runner.stop if blocked.",
    ].join("\n");

  return [
    "Execute the approved TODO plan to completion.",
    "",
    ...remaining.map((step) => `${step.step}. ${step.text}`),
    "",
    "Use runner.progress before ending each turn, with any newly completed steps and/or a concise progress summary. Use runner.stop if the plan is blocked or invalidated.",
  ].join("\n");
}

function rejectedProposal(
  decision: Exclude<SupervisionDecision, { type: "allow" }>,
  state: PlanState,
) {
  if (decision.type === "block") {
    throw new Error(`Runner proposal blocked: ${decision.reason}`);
  }
  return {
    content: [{ type: "text" as const, text: decision.context }],
    details: state,
  };
}

export default function runnerExtension(pi: ExtensionAPI): void {
  let state: PlanState = emptyPlan("runner");

  loopController.setExhaustedHandler("runner", (loop) => {
    if (state.status !== "running") return;
    state.status = "stopped";
    state.stopReason = loop.stopReason ?? `Runner loop exhausted after ${loop.maxTurns} turns`;
    savePlanState(pi, state);
  });

  pi.on("session_start", async (_event, ctx) => {
    state = restorePlanState(ctx.sessionManager.getEntries()) ?? state;
  });

  pi.registerTool({
    name: "runner",
    label: "Runner",
    description:
      "Execute an approved TODO plan as a supervised protocol. The agent interprets the plan and session trace; runner supervisors evaluate start, progress, finish, and stop proposals and may allow, block, or inject corrective context. Runtime loop ownership and exhaustion remain hard lifecycle state. Completing TODO steps records evidence but does not itself declare the task complete.",
    promptGuidelines: [
      "After runner.start, execute the first remaining step in the current turn instead of waiting for a follow-up.",
      "Before every agent_end while runner is active, call runner.progress even when no whole step completed; use summary to report partial progress.",
      "Treat completed TODO steps as execution evidence, not as a completion verdict. After every step is reported complete, apply assess-task-completion and call runner.finish with concise evidence only when the requested outcome is supported.",
      "If supervision injects additional context, use it to re-evaluate the next action instead of treating the proposal as accepted.",
      "Use runner.stop when the approved plan becomes invalid, blocked, or requires a material decision outside its acceptance boundary.",
      "Do not call loop.report or loop.stop for a runner-owned loop; runner owns its continuation state.",
    ],
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("start"),
        Type.Literal("progress"),
        Type.Literal("finish"),
        Type.Literal("stop"),
        Type.Literal("status"),
      ]),
      steps: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }))),
      summary: Type.Optional(Type.String({ description: "Progress made during the current turn" })),
      evidence: Type.Optional(
        Type.String({ description: "Concise evidence that the requested outcome is satisfied" }),
      ),
      reason: Type.Optional(Type.String()),
      maxTurns: Type.Optional(
        Type.Integer({ minimum: 1, description: "Maximum runner turns before loop exhaustion" }),
      ),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      state = restorePlanState(ctx.sessionManager.getEntries()) ?? state;

      if (params.action === "status") {
        const loop = loopController.snapshot();
        return {
          content: [
            {
              type: "text" as const,
              text: `Runner status: ${state.status}${loop?.owner === "runner" ? `; loop=${loop.status} (${loop.turns}/${loop.maxTurns})` : ""}`,
            },
          ],
          details: state,
        };
      }

      let proposal: RunnerProposal;
      if (params.action === "start") {
        proposal = { type: "start", maxTurns: params.maxTurns ?? 16 };
      } else if (params.action === "progress") {
        proposal = {
          type: "progress",
          ...(params.steps?.length ? { steps: params.steps } : {}),
          ...(params.summary?.trim() ? { summary: params.summary.trim() } : {}),
        };
      } else if (params.action === "finish") {
        proposal = {
          type: "finish",
          ...(params.evidence?.trim() ? { evidence: params.evidence.trim() } : {}),
        };
      } else {
        proposal = { type: "stop", reason: params.reason?.trim() || "Stopped by user" };
      }

      const protocolContext: RunnerProtocolContext = {
        proposal,
        observation: { plan: state, loop: loopController.snapshot() },
        trace: ctx.sessionManager.getEntries(),
      };
      const supervision = await supervise(protocolContext, runnerSupervisors);
      if (supervision.decision.type !== "allow")
        return rejectedProposal(supervision.decision, state);

      if (proposal.type === "start") {
        loopController.start("runner", taskFor(state), proposal.maxTurns);
        state.status = "running";
        state.stage = "runner";
        delete state.stopReason;
        savePlanState(pi, state);
        return {
          content: [
            {
              type: "text" as const,
              text: "Runner started. Execute the first remaining step now and report progress before ending this turn.",
            },
          ],
          details: state,
        };
      }

      if (proposal.type === "progress") {
        try {
          if (proposal.steps?.length) recordProgress(state, [...proposal.steps]);
        } catch (error) {
          state.status = "stopped";
          state.stopReason = String(error);
          savePlanState(pi, state);
          try {
            loopController.report("runner", "blocked", state.stopReason);
          } catch {
            // Preserve the plan failure even if loop state was already lost.
          }
          throw new Error(`Runner stopped: ${state.stopReason}`);
        }

        savePlanState(pi, state);
        const verificationPending = remainingSteps(state).length === 0;
        try {
          loopController.updateTask("runner", taskFor(state));
          const completedText = proposal.steps?.length
            ? `Completed step(s): ${proposal.steps.join(", ")}.`
            : undefined;
          loopController.report(
            "runner",
            "continue",
            [completedText, proposal.summary].filter(Boolean).join(" ") || undefined,
          );
        } catch (error) {
          state.status = "stopped";
          state.stopReason = `Runner loop unavailable: ${String(error)}`;
          savePlanState(pi, state);
          throw new Error(state.stopReason);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: verificationPending
                ? "All TODO steps are reported complete. Apply assess-task-completion, then call runner.finish with concise evidence only when the requested outcome is supported."
                : "Progress recorded.",
            },
          ],
          details: state,
        };
      }

      if (proposal.type === "finish") {
        state.status = "completed";
        delete state.stopReason;
        savePlanState(pi, state);
        try {
          loopController.report("runner", "done", proposal.evidence);
        } catch (error) {
          throw new Error(`Plan completed, but runner loop finalization failed: ${String(error)}`);
        }
        return {
          content: [{ type: "text" as const, text: "Plan completed after supervised finish." }],
          details: state,
        };
      }

      state.status = "stopped";
      state.stopReason = proposal.reason;
      savePlanState(pi, state);
      const loop = loopController.snapshot();
      if (loop?.status === "active" && loop.owner === "runner") {
        try {
          loopController.stop("runner", state.stopReason);
        } catch {
          // Plan state records the explicit stop even if loop state was already lost.
        }
      }
      return {
        content: [{ type: "text" as const, text: `Runner stopped: ${state.stopReason}` }],
        details: state,
      };
    },
  });
}
