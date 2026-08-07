import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function planExtension(pi: ExtensionAPI): void {
  pi.registerCommand("plan", {
    description: "Create or manage a plan through grill, planner, and runner.",
    handler: async (args, ctx) => {
      const input = args.trim();
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
      await ctx.ui.notify("Plan workflow started: grill → planner → runner.", "info");
      pi.sendUserMessage(
        input ||
          "Start the plan workflow. Ground the repository, clarify intent, challenge the design, and resolve the architecture.",
        { deliverAs: "followUp" },
      );
    },
  });
}
