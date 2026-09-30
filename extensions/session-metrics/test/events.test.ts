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
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 7,
      cost: 0,
      cacheCost: 0,
    },
  });
});

test("reconstructs bounded nested tool outcomes and incomplete parent results", () => {
  const events = [
    ...eventsFromLines([
      JSON.stringify({
        type: "message",
        timestamp: "2026-09-30T00:00:02.000Z",
        message: {
          role: "toolResult",
          toolCallId: "codemode-call",
          toolName: "codemode",
          content: [{ type: "text", text: "script completed" }],
          isError: false,
          nestedCalls: {
            complete: false,
            calls: [
              {
                id: "codemode/1",
                name: "read",
                arguments: { path: "src/a.ts" },
                status: "ok",
                durationMs: 12,
              },
              {
                id: "codemode/2",
                name: "bash",
                status: "error",
                durationMs: 4,
                error: "command failed",
              },
            ],
          },
        },
      }),
    ]),
  ];

  assert.deepEqual(
    events.map((event) => event.kind),
    ["tool_call", "tool_result", "tool_call", "tool_result", "tool_result"],
  );
  assert.equal(events[0]?.kind === "tool_call" && events[0].nested, true);
  assert.equal(events[1]?.kind === "tool_result" && events[1].durationMs, 12);
  assert.equal(events[3]?.kind === "tool_result" && events[3].isError, true);
  assert.equal(events[4]?.kind === "tool_result" && events[4].nestedCallsIncomplete, true);
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
