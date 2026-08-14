import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createTurnObservation, observeToolResult } from "./observation.ts";
import { buildAgentStartPrompt } from "./prompts/agent-start.ts";
import { buildTurnBoundaryPrompt } from "./prompts/turn-boundary.ts";

const REMINDER_TYPE = "inception:reminder";

export default function inceptionExtension(pi: ExtensionAPI): void {
  let turn = createTurnObservation();
  let pendingReminder: string | undefined;

  pi.on("before_agent_start", async (event) => {
    turn = createTurnObservation();
    pendingReminder = undefined;
    const prompt = buildAgentStartPrompt(event.systemPromptOptions?.contextFiles ?? []);
    return prompt ? { systemPrompt: `${event.systemPrompt}\n\n${prompt}` } : undefined;
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
