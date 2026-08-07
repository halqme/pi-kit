import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  buildAgentStartPrompt,
  buildTurnBoundaryPrompt,
  createTurnObservation,
  observeToolResult,
} from "./prompts.ts";

const REMINDER_TYPE = "inception:reminder";

export default function inceptionExtension(pi: ExtensionAPI): void {
  let turn = createTurnObservation();
  let pendingReminder: string | undefined;

  pi.on("before_agent_start", async (event) => {
    turn = createTurnObservation();
    pendingReminder = undefined;
    return { systemPrompt: `${event.systemPrompt}\n\n${buildAgentStartPrompt(event.prompt)}` };
  });

  pi.on("tool_result", async (event) => {
    observeToolResult(turn, {
      toolName: event.toolName,
      input: event.input,
      isError: event.isError,
    });
  });

  pi.on("turn_end", async () => {
    pendingReminder = buildTurnBoundaryPrompt(turn);
    turn = createTurnObservation();
  });

  pi.on("context", async (event) => {
    if (!pendingReminder) return undefined;
    const reminder = pendingReminder;
    pendingReminder = undefined;
    return {
      messages: [
        ...event.messages,
        {
          role: "custom" as const,
          customType: REMINDER_TYPE,
          content: reminder,
          display: false,
          timestamp: Date.now(),
        },
      ],
    };
  });
}
