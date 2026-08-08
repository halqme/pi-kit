import assert from "node:assert/strict";
import test from "node:test";
import { addToReport, analyzeLines, createReport } from "../src/analyze.ts";

test("aggregates usage, tool latency, and errors from generic session events", () => {
  const result = analyzeLines([
    JSON.stringify({
      type: "session",
      id: "s1",
      cwd: "/tmp",
      timestamp: "2026-01-01T00:00:00.000Z",
    }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-01-01T00:00:01.000Z",
      message: {
        role: "assistant",
        model: "model-a",
        stopReason: "toolUse",
        usage: { input: 10, output: 4, cacheRead: 20, totalTokens: 34 },
        content: [
          { type: "toolCall", id: "call-1", name: "example", arguments: { action: "anything" } },
        ],
      },
    }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-01-01T00:00:01.125Z",
      message: {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "example",
        isError: true,
        content: [{ type: "text", text: "failed" }],
      },
    }),
    JSON.stringify({
      type: "message",
      timestamp: "2026-01-01T00:00:02.000Z",
      message: {
        role: "assistant",
        model: "model-a",
        stopReason: "stop",
        usage: { totalTokens: 2 },
        content: [],
      },
    }),
  ]);

  assert.equal(result.sessionId, "s1");
  assert.equal(result.turns, 1);
  assert.equal(result.toolCallsByName.example, 1);
  assert.equal(result.toolUsage.example?.calls, 1);
  assert.equal(result.toolUsage.example?.errors, 1);
  assert.equal(result.toolUsage.example?.completedCalls, 1);
  assert.equal(result.toolUsage.example?.totalDurationMs, 125);
  assert.equal(result.toolUsage.example?.maxDurationMs, 125);
  assert.equal(result.models["model-a"]?.messages, 2);
  assert.equal(result.tokens.total, 36);
  assert.equal(result.toolErrors, 1);
  assert.equal(result.errors, 1);
});

test("tracks thinking levels as model effort", () => {
  const result = analyzeLines([
    JSON.stringify({ type: "thinking_level_change", thinkingLevel: "high" }),
    JSON.stringify({
      type: "message",
      message: { role: "assistant", usage: { totalTokens: 42 }, content: [] },
    }),
  ]);
  assert.equal(result.thinkingLevels.high?.messages, 1);
  assert.equal(result.thinkingLevels.high?.usage.total, 42);
  assert.equal(Object.values(result.modelEfforts)[0]?.messages, 1);
});

test("prefers explicit turn_end records over inferred stop reasons", () => {
  const result = analyzeLines([
    JSON.stringify({ type: "turn_end" }),
    JSON.stringify({ type: "turn_end" }),
    JSON.stringify({
      type: "message",
      message: { role: "assistant", stopReason: "stop", content: [] },
    }),
  ]);
  assert.equal(result.turns, 2);
});

test("counts malformed JSONL without discarding valid events", () => {
  const result = analyzeLines([
    "not json",
    JSON.stringify({ type: "session", id: "s1" }),
    JSON.stringify({ type: "message", message: { role: "user", content: [] } }),
  ]);
  assert.equal(result.invalidLines, 1);
  assert.equal(result.sessions, 1);
  assert.equal(result.userMessages, 1);
});

test("collects metrics by UTC day, ISO week, month, and project", () => {
  const report = createReport();
  addToReport(
    report,
    analyzeLines([
      JSON.stringify({
        type: "session",
        id: "s1",
        timestamp: "2026-01-01T12:00:00.000Z",
        cwd: "/repo/one",
      }),
      JSON.stringify({ type: "turn_end" }),
    ]),
  );
  addToReport(
    report,
    analyzeLines([
      JSON.stringify({
        type: "session",
        id: "s2",
        timestamp: "2026-01-04T12:00:00.000Z",
        cwd: "/repo/two",
      }),
      JSON.stringify({ type: "turn_end" }),
    ]),
  );

  assert.equal(report.daily["2026-01-01"]!.turns, 1);
  assert.equal(report.weekly["2026-W01"]!.sessions, 2);
  assert.equal(report.monthly["2026-01"]!.sessions, 2);
  assert.equal(report.projects["/repo/one"]!.sessions, 1);
  assert.equal(report.projects["/repo/two"]!.turns, 1);
});
