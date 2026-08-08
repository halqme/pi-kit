import assert from "node:assert/strict";
import test from "node:test";
import { addToReport, analyzeLines, createReport } from "../src/analyze.ts";
import { formatTokens, renderSummary } from "../src/report.ts";

test("renders deterministic generic summary and token cache details", () => {
  const report = createReport();
  addToReport(
    report,
    analyzeLines([
      JSON.stringify({
        type: "session",
        id: "s1",
        cwd: "/repo",
        timestamp: "2026-04-12T00:00:00Z",
      }),
      JSON.stringify({ type: "turn_end" }),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          model: "model/a",
          usage: {
            input: 100_000,
            cacheRead: 900_000,
            totalTokens: 1_240_000,
            cost: { total: 18.42 },
          },
          content: [],
        },
      }),
    ]),
  );
  const output = renderSummary(report);
  assert.match(output, /Session Metrics/);
  assert.match(output, /Cache hit/);
  assert.match(output, /90\.0%/);
  assert.match(output, /Top model \/ effort/);
  assert.match(output, /\$14\.8548/);
  assert.match(output, /Top tools/);
  assert.doesNotMatch(output, /Top skills/);
  assert.equal(formatTokens(820_000), "820K");
});

test("renders tool latency from paired call and result timestamps", () => {
  const report = createReport();
  addToReport(
    report,
    analyzeLines([
      JSON.stringify({ type: "session", id: "s1", timestamp: "2026-04-12T00:00:00Z" }),
      JSON.stringify({
        type: "message",
        timestamp: "2026-04-12T00:00:01.000Z",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "call-1", name: "read", arguments: {} }],
        },
      }),
      JSON.stringify({
        type: "message",
        timestamp: "2026-04-12T00:00:01.250Z",
        message: {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "read",
          content: [{ type: "text", text: "result" }],
        },
      }),
    ]),
  );
  const output = renderSummary(report, { view: "tools" });
  assert.match(output, /read/);
  assert.match(output, /250ms/);
});

test("supports period views, since, and limit", () => {
  const report = createReport();
  for (const [id, date] of [
    ["a", "2026-04-01"],
    ["b", "2026-04-02"],
  ]) {
    addToReport(
      report,
      analyzeLines([JSON.stringify({ type: "session", id, timestamp: `${date}T00:00:00Z` })]),
    );
  }
  const output = renderSummary(report, { view: "daily", since: "2026-04-02", limit: 1 });
  assert.match(output, /2026-04-02/);
  assert.doesNotMatch(output, /2026-04-01/);
});

test("keeps activity chart columns aligned across weekday rows", () => {
  const report = createReport();
  addToReport(
    report,
    analyzeLines([
      JSON.stringify({ type: "session", id: "s1", timestamp: "2026-04-12T00:00:00Z" }),
      JSON.stringify({
        type: "message",
        message: { role: "assistant", usage: { totalTokens: 100 }, content: [] },
      }),
    ]),
  );
  const output = renderSummary(report);
  const lines = output.split("\n");
  const start = lines.indexOf("Recent activity (tokens, 30 days)");
  assert.notEqual(start, -1);
  const rows = lines.slice(start + 1, start + 8);
  assert.equal(rows.length, 7);
  assert.equal(new Set(rows.map((row) => row.length)).size, 1);
});

test("renders empty reports without throwing", () => {
  const output = renderSummary(createReport());
  assert.match(output, /Session Metrics/);
  assert.match(output, /\$0\.00/);
});
