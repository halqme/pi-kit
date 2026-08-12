import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { emptyPlan, restorePlanState, savePlanState, type PlanState } from "@halqme/plan-state";
export default function plannerExtension(pi: ExtensionAPI): void {
  let state: PlanState = emptyPlan("planner");
  pi.registerTool({
    name: "planner",
    label: "Planner",
    description: "Turn a resolved ARCHITECTURE specification into an approval-gated TODO plan.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("create"), Type.Literal("approve"), Type.Literal("status")]),
      architecture: Type.Optional(Type.String()),
      steps: Type.Optional(Type.Array(Type.String({ minLength: 4 }))),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      state = restorePlanState(ctx.sessionManager.getEntries()) ?? state;
      if (params.action === "create") {
        if (!params.architecture?.trim() || !params.steps?.length)
          throw new Error("architecture and steps are required");
        state = emptyPlan("planner");
        state.architecture = params.architecture.trim();
        state.steps = params.steps.map((text, i) => ({
          step: i + 1,
          text: text.trim(),
          completed: false,
        }));
        state.todo = `TODO\n${state.steps.map((step) => `${step.step}. ${step.text}`).join("\n")}`;
        state.status = "planned";
        savePlanState(pi, state);
        return {
          content: [
            { type: "text" as const, text: "TODO plan created; explicit approval is required." },
          ],
          details: state,
        };
      }
      if (params.action === "approve") {
        if (state.status !== "planned") throw new Error("No planned TODO is awaiting approval.");
        state.status = "approved";
        savePlanState(pi, state);
        return {
          content: [{ type: "text" as const, text: "TODO plan approved." }],
          details: state,
        };
      }
      return {
        content: [{ type: "text" as const, text: `Planner status: ${state.status}` }],
        details: state,
      };
    },
  });
}
