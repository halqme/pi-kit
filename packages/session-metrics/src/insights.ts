export type InsightName =
  | "tool-errors"
  | "tool-token-outliers"
  | "tool-latency-outliers"
  | "cache-usage-summary"
  | "cache-anomalies"
  | "token-usage-summary"
  | "turn-token-usage"
  | "tool-usage-summary";

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function limitClause(limit: number): string {
  return `LIMIT ${Math.max(1, Math.min(100, Math.trunc(limit)))}`;
}

export function insightQuery(
  analysis: InsightName,
  options: { tool?: string; since?: string; limit?: number } = {},
): string {
  const tool = options.tool ? ` AND r.tool_name = ${literal(options.tool)}` : "";
  const since = options.since ? ` AND CAST(r.created_at AS DATE) >= ${literal(options.since)}` : "";
  const limit = limitClause(options.limit ?? 20);
  if (analysis === "tool-errors")
    return `SELECT r.tool_name, coalesce(r.error_kind, 'unknown') AS error_kind, count(*) AS errors,
  round(avg(r.duration_ms), 1) AS avg_duration_ms,
  round(avg(r.output_bytes), 1) AS avg_output_bytes
FROM tool_results r
WHERE r.is_error${tool}${since}
GROUP BY r.tool_name, error_kind
ORDER BY errors DESC, r.tool_name
${limit};`;
  if (analysis === "tool-token-outliers")
    return `SELECT r.source_path, r.session_id, r.tool_name, r.reported_tokens, r.estimated_tokens,
  r.output_bytes, r.is_error, r.created_at
FROM tool_results r
WHERE 1 = 1${tool}${since}
ORDER BY r.estimated_tokens DESC NULLS LAST
${limit};`;
  if (analysis === "tool-usage-summary")
    return `SELECT r.tool_name, count(*) AS calls, sum(CASE WHEN r.is_error THEN 1 ELSE 0 END) AS errors,
  round(100.0 * avg(CASE WHEN r.is_error THEN 1 ELSE 0 END), 2) AS error_rate_percent,
  round(avg(r.duration_ms), 1) AS avg_duration_ms,
  round(quantile_cont(r.duration_ms, 0.5), 1) AS p50_duration_ms,
  round(quantile_cont(r.duration_ms, 0.95), 1) AS p95_duration_ms,
  round(avg(coalesce(r.reported_tokens, r.estimated_tokens)), 1) AS avg_result_tokens,
  sum(r.output_bytes) AS output_bytes
FROM tool_results r
WHERE r.duration_ms IS NOT NULL${tool}${since}
GROUP BY r.tool_name
ORDER BY calls DESC, r.tool_name
${limit};`;
  if (analysis === "cache-usage-summary")
    return `SELECT u.model, count(*) AS turns,
  sum(u.input_tokens) AS uncached_input_tokens,
  sum(u.cache_read_tokens) AS cache_read_tokens,
  sum(u.cache_write_tokens) AS cache_write_tokens,
  round(100.0 * sum(u.cache_read_tokens) /
    NULLIF(sum(u.input_tokens) + sum(u.cache_read_tokens), 0), 2) AS cache_hit_percent,
  round(sum(u.cache_rebill_cost), 6) AS cache_rebill_cost
FROM assistant_usage u
JOIN messages m ON m.event_id = u.event_id
WHERE 1 = 1${options.since ? ` AND CAST(m.created_at AS DATE) >= ${literal(options.since)}` : ""}
GROUP BY u.model
ORDER BY cache_read_tokens DESC
${limit};`;
  if (analysis === "cache-anomalies")
    return `WITH turns AS (
  SELECT u.source_path, u.session_id, u.model, m.created_at,
    u.input_tokens, u.cache_read_tokens, u.total_tokens,
    lag(m.created_at) OVER (PARTITION BY u.session_id ORDER BY m.created_at) AS previous_at
  FROM assistant_usage u
  JOIN messages m ON m.event_id = u.event_id
  WHERE 1 = 1${options.since ? ` AND CAST(m.created_at AS DATE) >= ${literal(options.since)}` : ""}
)
SELECT source_path, session_id, model, created_at, previous_at,
  date_diff('minute', previous_at, created_at) AS gap_minutes,
  input_tokens, cache_read_tokens, total_tokens
FROM turns
WHERE cache_read_tokens = 0
  AND input_tokens >= 1000
  AND previous_at IS NOT NULL
  AND date_diff('minute', previous_at, created_at) <= 10
ORDER BY created_at DESC
${limit};`;
  if (analysis === "token-usage-summary")
    return `SELECT u.model, count(*) AS turns, sum(u.input_tokens) AS input_tokens,
  sum(u.output_tokens) AS output_tokens, sum(u.cache_read_tokens) AS cache_read_tokens,
  sum(u.cache_write_tokens) AS cache_write_tokens, sum(u.reasoning_tokens) AS reasoning_tokens,
  sum(u.total_tokens) AS total_tokens, round(sum(u.cost), 6) AS cost
FROM assistant_usage u
JOIN messages m ON m.event_id = u.event_id
WHERE 1 = 1${options.tool ? ` AND EXISTS (SELECT 1 FROM tool_calls c WHERE c.event_id LIKE u.event_id || ':tool:%' AND c.tool_name = ${literal(options.tool)})` : ""}${options.since ? ` AND CAST(m.created_at AS DATE) >= ${literal(options.since)}` : ""}
GROUP BY u.model
ORDER BY total_tokens DESC
${limit};`;
  if (analysis === "turn-token-usage")
    return `SELECT u.source_path, u.session_id, u.model, m.created_at,
  u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_write_tokens,
  u.reasoning_tokens, u.total_tokens, round(u.cost, 6) AS cost
FROM assistant_usage u
JOIN messages m ON m.event_id = u.event_id
WHERE 1 = 1${options.since ? ` AND CAST(m.created_at AS DATE) >= ${literal(options.since)}` : ""}
ORDER BY m.created_at DESC
${limit};`;
  return `SELECT r.source_path, r.session_id, r.tool_name, r.duration_ms,
  r.output_bytes, r.is_error, r.created_at
FROM tool_results r
WHERE r.duration_ms IS NOT NULL${tool}${since}
ORDER BY r.duration_ms DESC
${limit};`;
}
