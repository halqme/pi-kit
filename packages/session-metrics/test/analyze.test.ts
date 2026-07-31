import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLines } from "../src/analyze.ts";

test("aggregates tokens, turns, tools, and errors from session JSONL", () => {
  const result = analyzeLines([
    JSON.stringify({ type: "session", id: "s1", cwd: "/tmp" }),
    JSON.stringify({ type: "turn_end" }),
    JSON.stringify({ type: "message", message: { role: "assistant", usage: { input: 10, output: 4, cacheRead: 2, cacheWrite: 1, totalTokens: 17 }, content: [{ type: "toolCall", name: "read" }] } }),
    JSON.stringify({ type: "message", message: { role: "toolResult", isError: true } }),
  ]);
  assert.equal(result.sessionId, "s1");
  assert.equal(result.turns, 1);
  assert.equal(result.toolCallsByName.read, 1);
  assert.deepEqual(result.tokens, { input: 10, output: 4, cacheRead: 2, cacheWrite: 1, total: 17, cost: 0 });
  assert.equal(result.models.unknown?.messages, 1);
  assert.equal(result.toolUsage.read?.calls, 1);
  assert.equal(result.errors, 1);
});
