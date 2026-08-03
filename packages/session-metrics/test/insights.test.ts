import test from "node:test";
import assert from "node:assert/strict";
import { insightQuery } from "../src/insights.ts";

test("builds bounded tool error queries", () => {
  const sql = insightQuery("tool-errors", { tool: "read", limit: 7 });
  assert.match(sql, /WHERE r\.is_error/);
  assert.match(sql, /r\.tool_name = 'read'/);
  assert.match(sql, /LIMIT 7/);
});

test("builds token and latency outlier queries", () => {
  assert.match(insightQuery("tool-token-outliers"), /ORDER BY r\.estimated_tokens DESC/);
  assert.match(
    insightQuery("tool-latency-outliers", { since: "2026-01-01" }),
    /created_at.*2026-01-01/s,
  );
});

test("builds per-turn token usage queries", () => {
  const sql = insightQuery("turn-token-usage", { since: "2026-08-03", limit: 10 });
  assert.match(sql, /FROM assistant_usage u/);
  assert.match(sql, /u\.input_tokens/);
  assert.match(sql, /u\.output_tokens/);
  assert.match(sql, /m\.created_at/);
  assert.match(sql, /LIMIT 10/);
});

test("builds detailed tool usage summaries", () => {
  const sql = insightQuery("tool-usage-summary", { tool: "astrolabe" });
  assert.match(sql, /error_rate_percent/);
  assert.match(sql, /quantile_cont.*0\.95/);
  assert.match(sql, /avg_result_tokens/);
});

test("builds assistant token usage summaries", () => {
  const sql = insightQuery("token-usage-summary", { tool: "astrolabe", since: "2026-08-03" });
  assert.match(sql, /FROM assistant_usage u/);
  assert.match(sql, /EXISTS.*tool_calls/s);
  assert.match(sql, /sum\(u\.total_tokens\)/);
  assert.match(sql, /m\.created_at/);
});
