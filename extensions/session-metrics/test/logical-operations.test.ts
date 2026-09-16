import assert from "node:assert/strict";
import test from "node:test";
import { analyzeLines } from "../src/analyze.ts";

function assistantToolCall(timestamp: string, id: string) {
  return JSON.stringify({
    type: "message",
    timestamp,
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id, name: "example", arguments: {} }],
    },
  });
}

function toolResult(timestamp: string, id: string, isError = false) {
  return JSON.stringify({
    type: "message",
    timestamp,
    message: {
      role: "toolResult",
      toolCallId: id,
      toolName: "example",
      isError,
      content: [],
    },
  });
}

test("reports error-free operations without calling them task successes", () => {
  const metrics = analyzeLines([
    assistantToolCall("2026-09-16T00:00:00.000Z", "ok"),
    toolResult("2026-09-16T00:00:00.100Z", "ok"),
    JSON.stringify({ type: "turn_end", timestamp: "2026-09-16T00:00:00.200Z" }),
    assistantToolCall("2026-09-16T00:00:01.000Z", "failed"),
    toolResult("2026-09-16T00:00:01.100Z", "failed", true),
    JSON.stringify({ type: "turn_end", timestamp: "2026-09-16T00:00:01.200Z" }),
  ]);

  assert.equal(metrics.logicalOperations.operations, 2);
  assert.equal(metrics.logicalOperations.errorFree, 1);
  assert.equal(metrics.logicalOperations.errors, 1);
  assert.equal(metrics.logicalOperations.successes, metrics.logicalOperations.errorFree);
});
