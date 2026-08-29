import assert from "node:assert/strict";
import test from "node:test";
import { eventsFromLines } from "../src/events.ts";

test("normalizes assistant tool calls without interpreting tool-specific input", () => {
  const events = [
    ...eventsFromLines([
      JSON.stringify({
        type: "message",
        timestamp: "2026-08-08T00:00:00.000Z",
        message: {
          role: "assistant",
          model: "gpt-test",
          stopReason: "toolUse",
          usage: { input: 5, cacheRead: 10, totalTokens: 15 },
          content: [
            {
              type: "toolCall",
              id: "call-1",
              name: "astrolabe",
              arguments: { action: "locate", scope: "src" },
            },
          ],
        },
      }),
    ]),
  ];

  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    kind: "assistant_message",
    timestamp: "2026-08-08T00:00:00.000Z",
    model: "gpt-test",
    stopReason: "toolUse",
    usage: {
      input: 5,
      output: 0,
      cacheRead: 10,
      cacheWrite: 0,
      reasoning: 0,
      total: 15,
      cost: 0,
      cacheCost: 0,
    },
  });
  assert.deepEqual(events[1], {
    kind: "tool_call",
    timestamp: "2026-08-08T00:00:00.000Z",
    toolCallId: "call-1",
    toolName: "astrolabe",
    input: { action: "locate", scope: "src" },
  });
});

test("preserves generic tool result payload for external analyzers", () => {
  const events = [
    ...eventsFromLines([
      JSON.stringify({
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "example",
          content: [{ type: "text", text: "ok" }],
          details: { arbitrary: true },
          isError: false,
          usage: { totalTokens: 7 },
        },
      }),
    ]),
  ];
  assert.deepEqual(events[0], {
    kind: "tool_result",
    toolCallId: "call-1",
    toolName: "example",
    content: [{ type: "text", text: "ok" }],
    details: { arbitrary: true },
    isError: false,
    reportedTokens: 7,
  });
});

test("emits other events instead of teaching the core custom extension semantics", () => {
  const events = [
    ...eventsFromLines([
      JSON.stringify({ type: "custom", customType: "loop-state", data: { turns: 3 } }),
    ]),
  ];
  assert.equal(events[0]?.kind, "other");
  if (events[0]?.kind === "other") {
    assert.equal(events[0].type, "custom");
    assert.deepEqual(events[0].value, {
      type: "custom",
      customType: "loop-state",
      data: { turns: 3 },
    });
  }
});
