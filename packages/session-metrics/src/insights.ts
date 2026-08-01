export type InsightName = "tool-errors" | "tool-token-outliers" | "tool-latency-outliers";

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
  return `SELECT r.source_path, r.session_id, r.tool_name, r.duration_ms,
  r.output_bytes, r.is_error, r.created_at
FROM tool_results r
WHERE r.duration_ms IS NOT NULL${tool}${since}
ORDER BY r.duration_ms DESC
${limit};`;
}
