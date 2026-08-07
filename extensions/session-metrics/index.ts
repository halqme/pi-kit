import { homedir } from "node:os";
import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  buildReport,
  ingestSessions,
  recordLiveEvent,
  runInsight,
  type InsightName,
} from "@halqme/pi-session-metrics";

const SESSIONS_ROOT = join(homedir(), ".pi", "agent", "sessions");

export default function sessionMetricsExtension(pi: ExtensionAPI): void {
  let sessionWatcher: FSWatcher | undefined;
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleSync = () => {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(() => void ingestSessions(SESSIONS_ROOT).catch(() => undefined), 250);
  };
  const record = (event: Parameters<typeof recordLiveEvent>[0]) =>
    recordLiveEvent(event).catch(() => undefined);

  pi.on("session_start", async () => {
    sessionWatcher?.close();
    sessionWatcher = watch(SESSIONS_ROOT, { recursive: true }, (_event, filename) => {
      if (filename?.toString().endsWith(".jsonl")) scheduleSync();
    });
    scheduleSync();
  });
  pi.on("session_shutdown", async () => {
    sessionWatcher?.close();
    if (syncTimer) clearTimeout(syncTimer);
  });
  pi.on("before_agent_start", async (event, ctx) =>
    record({
      sessionId: ctx.sessionManager.getSessionId(),
      eventType: "request",
      payload: { prompt: event.prompt, images: event.images?.length ?? 0, model: ctx.model?.id },
    }),
  );
  pi.on("tool_call", async (event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    record({
      sessionId,
      eventType: "tool_call",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      payload: event.input,
    });
  });
  pi.on("turn_end", async (event, ctx) => {
    const message = event.message as { role?: string; model?: string; usage?: unknown };
    if (message.role === "assistant")
      record({
        sessionId: ctx.sessionManager.getSessionId(),
        eventType: "assistant_usage",
        payload: { model: message.model, usage: message.usage },
      });
  });
  pi.on("tool_result", async (event, ctx) =>
    record({
      sessionId: ctx.sessionManager.getSessionId(),
      eventType: "tool_result",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      payload: { input: event.input, content: event.content, details: event.details },
      isError: event.isError,
    }),
  );

  pi.registerTool({
    name: "session_metrics",
    label: "Session Metrics",
    description:
      "Inspect Pi session JSONL logs for cache usage, tool errors, usage, and token outliers. Reads logs directly and never builds an external index.",
    parameters: Type.Object({
      analysis: Type.Union([
        Type.Literal("tool-errors"),
        Type.Literal("tool-token-outliers"),
        Type.Literal("tool-latency-outliers"),
        Type.Literal("cache-usage-summary"),
        Type.Literal("cache-anomalies"),
        Type.Literal("token-usage-summary"),
        Type.Literal("turn-token-usage"),
        Type.Literal("tool-usage-summary"),
      ]),
      tool: Type.Optional(Type.String({ description: "Limit the analysis to one tool name." })),
      since: Type.Optional(Type.String({ description: "UTC date filter, YYYY-MM-DD." })),
      limit: Type.Optional(Type.Number({ description: "Maximum rows to return, 1-100." })),
      sessionsPath: Type.Optional(Type.String({ description: "Session JSONL root to read." })),
      refresh: Type.Optional(Type.Boolean({ default: true })),
    }),
    async execute(_toolCallId, params) {
      try {
        const sessionsPath = params.sessionsPath ?? SESSIONS_ROOT;
        const ingestion = params.refresh === false ? undefined : await ingestSessions(sessionsPath);
        const report = await buildReport(sessionsPath, params.since, params.limit);
        const rows = runInsight(params.analysis as InsightName, report, {
          ...(params.tool ? { tool: params.tool } : {}),
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
        });
        const prefix = ingestion
          ? `Read ${ingestion.indexed} changed file(s), skipped ${ingestion.skipped} unchanged file(s).\n\n`
          : "Read session JSONL logs directly.\n\n";
        return {
          content: [{ type: "text" as const, text: `${prefix}${JSON.stringify(rows, null, 2)}` }],
          details: { analysis: params.analysis },
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: error instanceof Error ? error.message : String(error) },
          ],
          details: { analysis: params.analysis },
          isError: true,
        };
      }
    },
  });
}
