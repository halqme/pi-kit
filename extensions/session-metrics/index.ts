import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  buildReport,
  renderSummary,
  type ReportView,
} from "@halqme/pi-session-metrics";

const SESSIONS_ROOT = join(homedir(), ".pi", "agent", "sessions");
const views = ["summary", "daily", "weekly", "projects", "models", "tools"] as const;

export default function sessionMetricsExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "session_metrics",
    label: "Session Metrics",
    description:
      "Read Pi session JSONL logs and summarize generic usage, cache, model, error, project, and tool metrics without instrumenting the active session.",
    parameters: Type.Object({
      view: Type.Optional(Type.Union(views.map((view) => Type.Literal(view)))),
      since: Type.Optional(Type.String({ description: "UTC date filter, YYYY-MM-DD." })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      sessionsPath: Type.Optional(Type.String({ description: "Session JSONL file or directory." })),
      json: Type.Optional(Type.Boolean({ default: false })),
    }),
    async execute(_toolCallId, params) {
      const view = (params.view ?? "summary") as ReportView;
      try {
        const report = await buildReport(params.sessionsPath ?? SESSIONS_ROOT, params.since);
        const text = params.json
          ? JSON.stringify(report, null, 2)
          : renderSummary(report, {
              view,
              ...(params.since ? { since: params.since } : {}),
              ...(params.limit !== undefined ? { limit: params.limit } : {}),
            });
        return {
          content: [{ type: "text" as const, text }],
          details: { view },
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: error instanceof Error ? error.message : String(error) },
          ],
          details: { view },
          isError: true,
        };
      }
    },
  });
}
