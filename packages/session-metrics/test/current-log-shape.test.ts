import assert from "node:assert/strict";
import test from "node:test";
import { analyzeLines } from "../src/analyze.ts";

test("infers turns and separates human, synthetic, tool, and model events", () => {
  const continuation =
    "Previous progress report: implemented the repository layer\n\n" +
    "Continue the active task:\n\nfinish the API\n\n" +
    "Before ending the next turn, call loop with action=report and status=continue, done, or blocked.";
  const result = analyzeLines([
    JSON.stringify({ type: "session", id: "s1", cwd: "/repo" }),
    JSON.stringify({
      type: "message",
      message: { role: "user", content: [{ type: "text", text: "Implement the API" }] },
    }),
    JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        stopReason: "toolUse",
        content: [
          { type: "toolCall", name: "astrolabe", arguments: { action: "locate" } },
          { type: "toolCall", name: "loop", arguments: { action: "report" } },
        ],
      },
    }),
    JSON.stringify({
      type: "message",
      message: { role: "toolResult", toolName: "astrolabe", isError: true, content: [] },
    }),
    JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "progress" }],
      },
    }),
    JSON.stringify({
      type: "message",
      message: { role: "user", content: [{ type: "text", text: continuation }] },
    }),
    JSON.stringify({
      type: "message",
      message: { role: "assistant", stopReason: "error", errorMessage: "connection timeout", content: [] },
    }),
    JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [{ type: "text", text: "done" }],
      },
    }),
  ]);

  assert.equal(result.turns, 2);
  assert.equal(result.userMessages, 2);
  assert.equal(result.humanUserMessages, 1);
  assert.equal(result.syntheticUserMessages, 1);
  assert.equal(result.toolErrors, 1);
  assert.equal(result.modelErrors, 1);
  assert.equal(result.errors, 2);
  assert.equal(result.toolCallsByOperation["astrolabe.locate"], 1);
  assert.equal(result.toolCallsByOperation["loop.report"], 1);
});

test("falls back to legacy turn_end entries when assistant stop reasons are absent", () => {
  const result = analyzeLines([
    JSON.stringify({ type: "session", id: "legacy" }),
    JSON.stringify({ type: "turn_end" }),
    JSON.stringify({ type: "turn_end" }),
    JSON.stringify({
      type: "message",
      message: { role: "assistant", content: [], usage: { totalTokens: 1 } },
    }),
  ]);
  assert.equal(result.turns, 2);
});
