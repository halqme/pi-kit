import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { emptyPlan, restorePlanState, savePlanState, type PlanState } from "@halqme/plan-state";

export default function grillExtension(pi: ExtensionAPI): void {
  let state: PlanState = emptyPlan("grill");
  pi.registerTool({
    name: "grill",
    label: "Grill",
    description:
      "Develop and challenge an implementation specification through grounding, clarifying, challenging, and resolved stages.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("start"), Type.Literal("resolve"), Type.Literal("status")]),
      goal: Type.Optional(Type.String()),
      architecture: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      state = restorePlanState(ctx.sessionManager.getEntries()) ?? state;
      if (params.action === "start") {
        state = emptyPlan("grill", params.goal);
        state.status = "grilling";
        savePlanState(pi, state);
        return {
          content: [
            {
              type: "text" as const,
              text: "Grill started. Ground the repository, clarify material uncertainty, and challenge the design before resolving it.",
            },
          ],
          details: state,
        };
      }
      if (params.action === "resolve") {
        if (!params.architecture?.trim()) throw new Error("architecture is required");
        state.architecture = params.architecture.trim();
        state.status = "resolved";
        savePlanState(pi, state);
        return {
          content: [{ type: "text" as const, text: "Architecture resolved." }],
          details: state,
        };
      }
      return {
        content: [{ type: "text" as const, text: `Grill status: ${state.status}` }],
        details: state,
      };
    },
  });
}
