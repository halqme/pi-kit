import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function planExtension(pi: ExtensionAPI): void {
  const lightPlanGuidance = [
    "<light-plan>",
    "For non-trivial requests, before the first implementation or research tool call, state a concise 2-4 step light plan.",
    "Identify independently verifiable workstreams, note a delegation candidate when useful, and keep unresolved product or architecture decisions with the parent.",
    "Skip planning ceremony for one-step requests. A light plan does not invoke grill, planner, or runner; use the full /plan workflow when architecture, risk, or lifecycle supervision warrants it.",
    "</light-plan>",
  ].join("\n");

  pi.on("before_agent_start", async (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${lightPlanGuidance}`,
  }));

  pi.registerCommand("plan", {
    description: "Create or manage a light or full plan through grill, planner, and runner.",
    handler: async (args, ctx) => {
      const input = args.trim();
      if (input === "light") {
        ctx.ui.notify("Light plan requested.", "info");
        pi.sendUserMessage(
          "Create a concise 2-4 step light plan before the first implementation or research tool call. Identify independently verifiable workstreams and delegation candidates; do not invoke the full grill/planner/runner workflow.",
          { deliverAs: "followUp" },
        );
        return;
      }
      if (input === "execute" || input === "do") {
        pi.sendUserMessage(
          "Start the approved TODO plan with runner and continue until completion or a blocking issue.",
          { deliverAs: "followUp" },
        );
        return;
      }
      if (input === "status") {
        pi.sendUserMessage(
          "Report the current grill, planner, and runner status from session state.",
          { deliverAs: "followUp" },
        );
        return;
      }
      if (input === "cancel") {
        pi.sendUserMessage("Stop the active plan safely and record the stop reason.", {
          deliverAs: "followUp",
        });
        return;
      }
      if (input.startsWith("refine ") || input.startsWith("fix ")) {
        pi.sendUserMessage(
          `Refine the current architecture or TODO plan using this feedback:\n\n${input.slice(input.indexOf(" ") + 1)}`,
          { deliverAs: "followUp" },
        );
        return;
      }
      ctx.ui.notify("Plan workflow started: grill → planner → runner.", "info");
      pi.sendUserMessage(
        input ||
          "Start the plan workflow. Ground the repository, clarify intent, challenge the design, and resolve the architecture.",
        { deliverAs: "followUp" },
      );
    },
  });
}
