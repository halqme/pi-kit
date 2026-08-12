import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loopController } from "./control.ts";

const LOOP_STATE_ENTRY = "loop-state";

function restore(ctx: ExtensionContext): void {
  for (const candidate of [...ctx.sessionManager.getEntries()].reverse()) {
    if (!candidate || typeof candidate !== "object") continue;
    const entry = candidate as { type?: unknown; customType?: unknown; data?: unknown };
    if (entry.type !== "custom" || entry.customType !== LOOP_STATE_ENTRY) continue;
    loopController.restore(entry.data);
    return;
  }
  loopController.restore(undefined);
}

function endedWithModelError(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const messages = (event as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return false;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message || typeof message !== "object") continue;
    const candidate = message as { role?: unknown; stopReason?: unknown };
    if (candidate.role !== "assistant") continue;
    return candidate.stopReason === "error";
  }
  return false;
}

export default function loopExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "loop",
    label: "Loop",
    description:
      "Manage one bounded self-continuation task. start defines the task but does not send an immediate follow-up. While a loop is active, report continue, done, or blocked before ending each turn; agent_end sends a follow-up only while the task remains unfinished. Failed model runs do not consume a loop turn. maxTurns is a runaway guard, not a completion condition. Runner-owned loops must be reported through runner instead of this tool.",
    promptGuidelines: [
      "Use loop when one task needs multiple agent turns and the agent can judge its own completion state.",
      "After start, work on the task in the current turn; do not end the turn just to wait for the loop.",
      "Before ending each active loop turn, report continue, done, or blocked. Include a concise progress summary when continuing.",
      "Do not use loop as a timer, background process, implementation delegate, or substitute for verifying results.",
    ],
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("start"),
        Type.Literal("report"),
        Type.Literal("status"),
        Type.Literal("stop"),
      ]),
      task: Type.Optional(Type.String({ description: "Task to keep advancing until completion" })),
      maxTurns: Type.Optional(
        Type.Integer({ minimum: 1, description: "Maximum agent turns before forced exhaustion" }),
      ),
      status: Type.Optional(
        Type.Union([Type.Literal("continue"), Type.Literal("done"), Type.Literal("blocked")]),
      ),
      summary: Type.Optional(
        Type.String({ description: "Progress, completion, or blocker summary" }),
      ),
      reason: Type.Optional(
        Type.String({ description: "Reason for explicitly stopping the loop" }),
      ),
    }),
    async execute(_id, params) {
      if (params.action === "status") {
        const state = loopController.snapshot();
        return {
          content: [
            {
              type: "text" as const,
              text: state
                ? `Loop ${state.status} (${state.turns}/${state.maxTurns} turns, owner=${state.owner}): ${state.task}`
                : "No loop state.",
            },
          ],
          details: state ?? {},
        };
      }
      if (params.action === "start") {
        if (!params.task?.trim()) throw new Error("task is required for start");
        const state = loopController.start("loop", params.task, params.maxTurns ?? 8);
        return {
          content: [
            {
              type: "text" as const,
              text: `Loop started for up to ${state.maxTurns} turns. Work on the task now and report its status before ending this turn.`,
            },
          ],
          details: state,
        };
      }
      if (params.action === "report") {
        if (!params.status) throw new Error("status is required for report");
        const state = loopController.report("loop", params.status, params.summary);
        return {
          content: [
            {
              type: "text" as const,
              text:
                params.status === "continue"
                  ? "Loop progress recorded; a follow-up will be sent after agent_end."
                  : `Loop ${state.status}.`,
            },
          ],
          details: state,
        };
      }
      const state = loopController.stop("loop", params.reason);
      return {
        content: [{ type: "text" as const, text: "Loop stopped." }],
        details: state,
      };
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    loopController.configure((state) => {
      if (state) pi.appendEntry(LOOP_STATE_ENTRY, state);
    });
    restore(ctx);
  });

  pi.on("agent_end", async (event) => {
    if (endedWithModelError(event)) return;
    const result = loopController.onAgentEnd();
    if (result.followUp) pi.sendUserMessage(result.followUp, { deliverAs: "followUp" });
    if (result.exhausted) {
      const state = loopController.snapshot();
      pi.sendMessage(
        {
          customType: "loop-status",
          content: `[loop] exhausted after ${state?.maxTurns ?? "?"} turns`,
          display: true,
          details: state ?? {},
        },
        { triggerTurn: false, deliverAs: "nextTurn" },
      );
    }
  });
}
