import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
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
          Type.Literal("overview"),
          Type.Literal("summary"),
          Type.Literal("all"),
          Type.Literal("daily"),
          Type.Literal("weekly"),
          Type.Literal("monthly"),
          Type.Literal("monthly-activity"),
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
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("session_metrics"))} ${theme.fg("accent", args.view ?? "overview")}`,
        0,
        0,
      );
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("warning", "Building session metrics..."), 0, 0);
      const content = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text ?? "")
        .join("\n");
      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = undefined;
      }
      if (context.isError) {
        return new Text(theme.fg("error", content || "Session metrics failed"), 0, 0);
      }
      const data = parsed?.data ?? parsed;
      const metrics = data?.metrics;
      let text = `view=${data?.kind ?? context.args.view ?? "overview"}`;
      if (metrics) {
        text += `; sessions=${metrics.sessions ?? 0}; turns=${metrics.turns ?? 0}; tool calls=${metrics.toolCalls ?? 0}; tokens=${metrics.tokens?.total ?? metrics.usage?.total ?? "?"}`;
      } else if (Array.isArray(data?.rows)) {
        text += `; ${data.rows.length} row(s)`;
      } else if (data?.report) {
        text += `; report=${data.report.sessions ?? 0} session(s)`;
      }
      if (expanded) text += `\n\n${content}`;
      return new Text(theme.fg("toolOutput", text), 0, 0);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const view = (params.view ?? "overview") as QueryView;
      const report = await buildReport(params.sessionsPath ?? SESSIONS_ROOT, params.since);
      if (
        view === "overview" ||
        view === "all" ||
        view === "skills" ||
        view === "tools" ||
        view === "tool-actions"
      ) {
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
    },
  });
}
