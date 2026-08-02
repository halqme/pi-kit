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
