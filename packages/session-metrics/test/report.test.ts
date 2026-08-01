import test from "node:test";
import assert from "node:assert/strict";
import { addToReport, analyzeLines, createReport } from "../src/analyze.ts";
import { formatTokens, renderSummary } from "../src/report.ts";

test("renders a deterministic human summary and formats token units", () => {
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
          usage: { totalTokens: 1_240_000, cost: { total: 18.42 } },
        },
      }),
    ]),
  );
  const output = renderSummary(report);
  assert.match(output, /Session Metrics/);
  assert.match(output, /\| Sessions \| Active days \|/);
  assert.match(output, /\| 1 \| 1 \| 1 \| 1 \| 0 \| 1 \| 0 \| 1\.2M \|/);
  assert.match(output, /Top model \/ effort/);
  assert.match(output, /\| Effort \|/);
  assert.match(output, /Top skills & tools/);
  assert.equal(formatTokens(820_000), "820K");
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

test("renders empty reports without throwing", () => {
  assert.match(renderSummary(createReport()), /\| 0 \| 0 \| 0 \| 0 \| 0 \| \$0\.00 \| 0 \|/);
});
