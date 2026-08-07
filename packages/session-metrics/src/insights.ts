import type { MetricsReport, ToolMetrics } from "./analyze.ts";

export type InsightName =
  | "tool-errors"
  | "tool-token-outliers"
  | "tool-latency-outliers"
  | "cache-usage-summary"
  | "cache-anomalies"
  | "token-usage-summary"
  | "turn-token-usage"
  | "tool-usage-summary";

const limitRows = <T>(rows: T[], limit = 20) => rows.slice(0, Math.max(1, Math.min(limit, 100)));

export function runInsight(
  analysis: InsightName,
  report: MetricsReport,
  options: { tool?: string; limit?: number } = {},
): unknown[] {
  const tools = Object.entries(report.toolUsage)
    .filter(([name]) => !options.tool || name === options.tool)
    .map(([tool, value]: [string, ToolMetrics]) => ({ tool, ...value }));
  if (analysis === "tool-errors")
    return limitRows(tools.filter((row) => row.errors > 0).sort((a, b) => b.errors - a.errors), options.limit);
  if (analysis === "tool-token-outliers")
    return limitRows(tools.sort((a, b) => b.estimatedResultTokens - a.estimatedResultTokens), options.limit);
  if (analysis === "tool-usage-summary" || analysis === "tool-latency-outliers")
    return limitRows(tools.sort((a, b) => b.calls - a.calls), options.limit);
  if (analysis === "cache-usage-summary" || analysis === "token-usage-summary")
    return [{ ...report.tokens, cacheHitPercent: report.tokens.input + report.tokens.cacheRead === 0 ? 0 : (100 * report.tokens.cacheRead) / (report.tokens.input + report.tokens.cacheRead) }];
  if (analysis === "turn-token-usage") return limitRows(Object.entries(report.daily).map(([day, metrics]) => ({ day, ...metrics.tokens })).sort((a, b) => b.day.localeCompare(a.day)), options.limit);
  return [];
}
