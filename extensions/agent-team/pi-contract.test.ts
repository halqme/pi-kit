import assert from "node:assert/strict";
import test from "node:test";
import { agentLoop } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, Type } from "@earendil-works/pi-ai";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const model = {
  id: "test-model",
  name: "test-model",
  api: "test-api",
  provider: "test-provider",
  baseUrl: "http://test.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1_000,
  maxTokens: 100,
} as any;

async function run(tool: any): Promise<any[]> {
  const assistant: any = {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-1", name: tool.name, arguments: {} }],
    api: "test-api",
    provider: "test-provider",
    model: "test-model",
    usage,
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
  const stream = agentLoop(
    [{ role: "user", content: "run the tool", timestamp: Date.now() }],
    { systemPrompt: "", messages: [], tools: [tool] },
    {
      model,
      convertToLlm: (messages: any[]) => messages as any,
      shouldStopAfterTurn: async () => true,
    },
    undefined,
    () => {
      const response = createAssistantMessageEventStream();
      response.push({ type: "done", reason: "toolUse", message: assistant });
      return response;
    },
  );
  const events: any[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function toolFlags(events: any[]): { execution: boolean; message: boolean } {
  const execution = events.find((event) => event.type === "tool_execution_end");
  const message = events.find(
    (event) => event.type === "message_end" && event.message.role === "toolResult",
  );
  assert.ok(execution);
  assert.ok(message);
  return { execution: execution.isError, message: message.message.isError };
}

test("Pi derives canonical tool errors from throw, not returned isError", async () => {
  const returned = await run({
    name: "returned",
    label: "Returned",
    description: "test",
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text", text: "returned" }], details: {}, isError: true };
    },
  });
  assert.deepEqual(toolFlags(returned), { execution: false, message: false });

  const thrown = await run({
    name: "thrown",
    label: "Thrown",
    description: "test",
    parameters: Type.Object({}),
    async execute() {
      throw new Error("thrown");
    },
  });
  assert.deepEqual(toolFlags(thrown), { execution: true, message: true });
});
