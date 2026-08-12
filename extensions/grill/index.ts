import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
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
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("grill"))} ${theme.fg("accent", args.action)}${args.goal ? ` ${theme.fg("dim", args.goal)}` : ""}`,
        0,
        0,
      );
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("warning", "Updating grill..."), 0, 0);
      const state = result.details as PlanState | undefined;
      const content = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text ?? "")
        .join("\n");
      let text = context.isError
        ? content.split("\n")[0] || "Grill failed"
        : `status=${state?.status ?? "unknown"}`;
      if (!context.isError) {
        if (state?.goal) text += `; goal=${state.goal}`;
        if (state?.architecture) text += "; architecture=resolved";
      }
      if (expanded) text += `\n\n${content}\n\n${JSON.stringify(state ?? {}, null, 2)}`;
      return new Text(theme.fg(context.isError ? "error" : "toolOutput", text), 0, 0);
    },
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
