import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  emptyPlan,
  recordProgress,
  remainingSteps,
  savePlanState,
  type PlanState,
} from "@halqme/plan-state";
export default function runnerExtension(pi: ExtensionAPI): void {
  let state: PlanState = emptyPlan("runner");
  pi.registerTool({
    name: "runner",
    label: "Runner",
    description:
      "Execute an approved TODO plan with progress tracking and stop safely when the plan is invalidated.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("start"),
        Type.Literal("progress"),
        Type.Literal("stop"),
        Type.Literal("status"),
      ]),
      steps: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }))),
      reason: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      if (params.action === "start") {
        if (state.status !== "approved")
          return {
            content: [{ type: "text" as const, text: "No approved plan is ready." }],
            details: state,
            isError: true,
          };
        state.status = "running";
        savePlanState(pi, state);
        pi.sendUserMessage("Execute the approved TODO from the first remaining step.", {
          deliverAs: "followUp",
        });
        return { content: [{ type: "text" as const, text: "Runner started." }], details: state };
      }
      if (params.action === "progress") {
        if (state.status !== "running" || !params.steps?.length)
          return {
            content: [
              { type: "text" as const, text: "Runner is not executing or steps are missing." },
            ],
            details: state,
            isError: true,
          };
        try {
          recordProgress(state, params.steps);
        } catch (error) {
          state.status = "stopped";
          state.stopReason = String(error);
          savePlanState(pi, state);
          return {
            content: [{ type: "text" as const, text: `Runner stopped: ${state.stopReason}` }],
            details: state,
            isError: true,
          };
        }
        savePlanState(pi, state);
        if (state.status === "running")
          pi.sendUserMessage(
            `Continue with remaining steps:\n${remainingSteps(state)
              .map((step) => `${step.step}. ${step.text}`)
              .join("\n")}`,
            { deliverAs: "followUp" },
          );
        return {
          content: [
            {
              type: "text" as const,
              text:
                state.steps.length > 0 && state.steps.every((step) => step.completed)
                  ? "Plan completed."
                  : "Progress recorded.",
            },
          ],
          details: state,
        };
      }
      if (params.action === "stop") {
        state.status = "stopped";
        state.stopReason = params.reason?.trim() || "Stopped by user";
        savePlanState(pi, state);
        return {
          content: [{ type: "text" as const, text: `Runner stopped: ${state.stopReason}` }],
          details: state,
        };
      }
      return {
        content: [{ type: "text" as const, text: `Runner status: ${state.status}` }],
        details: state,
      };
    },
  });
}
