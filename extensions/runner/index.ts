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
import { loopController } from "../loop/control.ts";

function taskFor(state: PlanState): string {
  const remaining = remainingSteps(state);
  return [
    "Execute the approved TODO plan to completion.",
    "",
    ...remaining.map((step) => `${step.step}. ${step.text}`),
    "",
    "Use runner.progress before ending each turn, with any newly completed steps and/or a concise progress summary. Use runner.stop if the plan is blocked or invalidated.",
  ].join("\n");
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
      "Execute an approved TODO plan through the shared loop continuation controller. start claims the loop for the plan but does not create a new turn; begin work immediately in the current turn. Before ending each running turn, call progress with completed steps and/or a concise summary. progress keeps the loop active while steps remain and completes it when the plan is finished. stop ends both the plan and its loop. If maxTurns is exhausted, the running plan is stopped automatically.",
    promptGuidelines: [
      "After runner.start, execute the first remaining step in the current turn instead of waiting for a follow-up.",
      "Before every agent_end while runner is active, call runner.progress even when no whole step completed; use summary to report partial progress.",
      "Use runner.stop when the approved plan becomes invalid, blocked, or requires a material decision outside its acceptance boundary.",
      "Do not call loop.report or loop.stop for a runner-owned loop; runner owns its continuation state.",
    ],
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("start"),
        Type.Literal("progress"),
        Type.Literal("stop"),
        Type.Literal("status"),
      ]),
      steps: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }))),
      summary: Type.Optional(Type.String({ description: "Progress made during the current turn" })),
      reason: Type.Optional(Type.String()),
      maxTurns: Type.Optional(
        Type.Integer({ minimum: 1, description: "Maximum runner turns before loop exhaustion" }),
      ),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      state = restorePlanState(ctx.sessionManager.getEntries()) ?? state;
      if (params.action === "start") {
        if (state.status !== "approved")
          return {
            content: [{ type: "text" as const, text: "No approved plan is ready." }],
            details: state,
            isError: true,
          };
        const activeLoop = loopController.snapshot();
        if (activeLoop?.status === "active")
          return {
            content: [
              {
                type: "text" as const,
                text: `Cannot start runner while a loop is active and owned by ${activeLoop.owner}.`,
              },
            ],
            details: state,
            isError: true,
          };
        try {
          loopController.start("runner", taskFor(state), params.maxTurns ?? 16);
          state.status = "running";
          state.stage = "runner";
          savePlanState(pi, state);
        } catch (error) {
          return {
            content: [{ type: "text" as const, text: String(error) }],
            details: state,
            isError: true,
          };
        }
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
      if (params.action === "progress") {
        if (state.status !== "running")
          return {
            content: [{ type: "text" as const, text: "Runner is not executing." }],
            details: state,
            isError: true,
          };
        const cleanSummary = params.summary?.trim();
        if (!params.steps?.length && !cleanSummary)
          return {
            content: [
              {
                type: "text" as const,
                text: "progress requires completed steps and/or a summary of partial progress",
              },
            ],
            details: state,
            isError: true,
          };
        try {
          if (params.steps?.length) recordProgress(state, params.steps);
        } catch (error) {
          state.status = "stopped";
          state.stopReason = String(error);
          savePlanState(pi, state);
          try {
            loopController.report("runner", "blocked", state.stopReason);
          } catch {
            // Preserve the plan failure even if loop state was already lost.
          }
          return {
            content: [{ type: "text" as const, text: `Runner stopped: ${state.stopReason}` }],
            details: state,
            isError: true,
          };
        }
        savePlanState(pi, state);
        try {
          if (state.status === "completed") {
            loopController.report(
              "runner",
              "done",
              cleanSummary || "All approved TODO steps completed.",
            );
          } else {
            loopController.updateTask("runner", taskFor(state));
            const completedText = params.steps?.length
              ? `Completed step(s): ${params.steps.join(", ")}.`
              : undefined;
            loopController.report(
              "runner",
              "continue",
              [completedText, cleanSummary].filter(Boolean).join(" ") || undefined,
            );
          }
        } catch (error) {
          state.status = "stopped";
          state.stopReason = `Runner loop unavailable: ${String(error)}`;
          savePlanState(pi, state);
          return {
            content: [{ type: "text" as const, text: state.stopReason }],
            details: state,
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: state.status === "completed" ? "Plan completed." : "Progress recorded.",
            },
          ],
          details: state,
        };
      }
      if (params.action === "stop") {
        state.status = "stopped";
        state.stopReason = params.reason?.trim() || "Stopped by user";
        savePlanState(pi, state);
        const loop = loopController.snapshot();
        if (loop?.status === "active" && loop.owner === "runner") {
          try {
            loopController.stop("runner", state.stopReason);
          } catch {
            // Plan state remains authoritative for the explicit stop.
          }
        }
        return {
          content: [{ type: "text" as const, text: `Runner stopped: ${state.stopReason}` }],
          details: state,
        };
      }
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
    },
  });
}
