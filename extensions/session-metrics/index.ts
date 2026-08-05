import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { insightQuery, type InsightName } from "../../packages/session-metrics/src/insights.ts";
import { ingestSessions, queryDatabase } from "../../packages/session-metrics/src/storage.ts";

const SESSIONS_ROOT = join(homedir(), ".pi", "agent", "sessions");

export default function sessionMetricsExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "session_metrics",
    label: "Session Metrics",
    description:
      "Inspect indexed Pi session logs for cache usage, tool errors, usage, turn tokens, token outliers, and latency. Refreshes the DuckDB index before querying.",
    parameters: Type.Object({
      analysis: Type.Union([
        Type.Literal("tool-errors"),
        Type.Literal("tool-token-outliers"),
        Type.Literal("tool-latency-outliers"),
        Type.Literal("cache-usage-summary"),
        Type.Literal("token-usage-summary"),
        Type.Literal("turn-token-usage"),
        Type.Literal("tool-usage-summary"),
      ]),
      tool: Type.Optional(Type.String({ description: "Limit the analysis to one tool name." })),
      since: Type.Optional(Type.String({ description: "UTC date filter, YYYY-MM-DD." })),
      limit: Type.Optional(Type.Number({ description: "Maximum rows to return, 1-100." })),
      sessionsPath: Type.Optional(Type.String({ description: "Session JSONL root to ingest." })),
      database: Type.Optional(Type.String({ description: "DuckDB database path." })),
      refresh: Type.Optional(Type.Boolean({ default: true })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        const database = params.database;
        const sessionsPath = params.sessionsPath ?? SESSIONS_ROOT;
        const ingestion =
          params.refresh === false ? undefined : await ingestSessions(sessionsPath, database);
        const sql = insightQuery(params.analysis as InsightName, {
          ...(params.tool ? { tool: params.tool } : {}),
          ...(params.since ? { since: params.since } : {}),
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
        });
        const rows = await queryDatabase(sql, database);
        const prefix = ingestion
          ? `Indexed ${ingestion.indexed} file(s), skipped ${ingestion.skipped} unchanged file(s).\n\n`
          : "Used the existing DuckDB index.\n\n";
        return {
          content: [{ type: "text" as const, text: `${prefix}${rows}` }],
          details: { analysis: params.analysis, sql },
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: error instanceof Error ? error.message : String(error) },
          ],
          details: {},
          isError: true,
        };
      }
    },
  });
}
