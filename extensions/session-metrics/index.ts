import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  addCurrentResources,
  buildReport,
  selectReport,
  type QueryView,
} from "@halqme/pi-session-metrics";

const SESSIONS_ROOT = join(homedir(), ".pi", "agent", "sessions");

export default function sessionMetricsExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "session_metrics",
    label: "Session Metrics",
    description:
      "Read Pi session JSONL logs and summarize usage, cache, models, skills, tools, tool actions, errors, and current Pi resource status without instrumenting the active session.",
    parameters: Type.Object({
      view: Type.Optional(
        Type.Union([
          Type.Literal("summary"),
          Type.Literal("daily"),
          Type.Literal("weekly"),
          Type.Literal("monthly"),
          Type.Literal("projects"),
          Type.Literal("models"),
          Type.Literal("skills"),
          Type.Literal("tools"),
          Type.Literal("tool-actions"),
          Type.Literal("logical-operations"),
        ]),
      ),
      since: Type.Optional(Type.String({ description: "UTC date filter, YYYY-MM-DD." })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      sessionsPath: Type.Optional(Type.String({ description: "Session JSONL file or directory." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const view = (params.view ?? "summary") as QueryView;
      try {
        const report = await buildReport(params.sessionsPath ?? SESSIONS_ROOT, params.since);
        if (view === "skills" || view === "tools") {
          await addCurrentResources(report, ctx.cwd);
        }
        const text = JSON.stringify(
          selectReport(report, {
            view,
            ...(params.since ? { since: params.since } : {}),
            ...(params.limit !== undefined ? { limit: params.limit } : {}),
            ...(params.sessionsPath ? { source: params.sessionsPath } : {}),
          }),
          null,
          2,
        );
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
