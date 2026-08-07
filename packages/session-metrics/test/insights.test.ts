import test from "node:test";
import assert from "node:assert/strict";
import { createReport } from "../src/analyze.ts";
import { runInsight } from "../src/insights.ts";

test("returns bounded direct tool summaries", () => {
  const report = createReport();
  report.toolUsage.read = { available: true, calls: 8, errors: 2, estimatedResultTokens: 120, reportedTokens: 100 };
  report.toolUsage.write = { available: true, calls: 2, errors: 0, estimatedResultTokens: 4, reportedTokens: 4 };
  assert.deepEqual(runInsight("tool-errors", report, { tool: "read" }), [{ tool: "read", ...report.toolUsage.read }]);
  assert.deepEqual(runInsight("tool-token-outliers", report, { limit: 1 }), [{ tool: "read", ...report.toolUsage.read }]);
});

test("summarizes tokens without a query engine", () => {
  const report = createReport();
  report.tokens.input = 100;
  report.tokens.cacheRead = 50;
  const rows = runInsight("cache-usage-summary", report) as Array<{ cacheHitPercent: number }>;
  assert.equal(rows[0]?.cacheHitPercent, 100 / 3);
});
