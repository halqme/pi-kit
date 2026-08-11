import { createMetrics, mergeMetrics } from "./analyze.ts";
import type { MetricsReport, MetricSummary } from "./types.ts";

export type QueryView =
  | "summary"
  | "daily"
  | "weekly"
  | "monthly"
  | "projects"
  | "models"
  | "skills"
  | "tools"
  | "tool-actions"
  | "logical-operations";

export interface MetricsQuery {
  view: QueryView;
  since?: string;
  limit?: number;
  source?: string;
}

export type SelectionData =
  | { kind: "summary"; metrics: MetricSummary }
  | { kind: "logical-operations"; metrics: MetricSummary["logicalOperations"] }
  | {
      kind: "period";
      period: "daily" | "weekly" | "monthly";
      rows: Array<{ period: string; metrics: MetricSummary }>;
    }
  | { kind: "projects"; rows: Array<{ project: string; metrics: MetricSummary }> }
  | {
      kind: "models";
      rows: Array<{ name: string; metrics: MetricSummary["modelEfforts"][string] }>;
    }
  | {
      kind: "skills";
      rows: Array<{
        name: string;
        metrics: MetricSummary["skills"][string];
        status?: "available" | "missing" | "unused";
      }>;
    }
  | {
      kind: "tools";
      rows: Array<{
        name: string;
        metrics: MetricSummary["toolUsage"][string];
        status?: "available" | "missing" | "unused";
      }>;
    }
  | {
      kind: "tool-actions";
      rows: Array<{
        tool: string;
        action: string;
        metrics: MetricSummary["toolActions"][string][string];
      }>;
    };

export interface SelectionResult {
  query: MetricsQuery;
  data: SelectionData;
}

function validSince(since?: string): string | undefined {
  if (!since) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || Number.isNaN(Date.parse(`${since}T00:00:00Z`)))
    throw new Error(`Invalid --since date: ${since}`);
  return since;
}

function validLimit(limit?: number): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
  return limit;
}

function rows<T>(items: T[], limit?: number): T[] {
  return limit === undefined ? items : items.slice(0, limit);
}

function periodEntries(
  report: MetricsReport,
  view: "daily" | "weekly" | "monthly",
  since?: string,
): Array<[string, MetricSummary]> {
  const minimum = since && view === "weekly" ? isoWeekKey(`${since}T00:00:00Z`) : since;
  return Object.entries(report[view])
    .filter(([key]) => !minimum || key >= minimum)
    .sort(([left], [right]) => right.localeCompare(left));
}

function isoWeekKey(timestamp: string): string {
  const date = new Date(timestamp);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function selectedMetrics(report: MetricsReport, since?: string): MetricSummary {
  if (!since) return report;
  return periodEntries(report, "daily", since).reduce(
    (total, [, metrics]) => mergeMetrics(total, metrics),
    createMetrics(),
  );
}

function toolEntries(report: MetricsReport, metrics: MetricSummary) {
  return Object.entries(metrics.toolUsage)
    .filter(([name]) => report.resources?.tools[name]?.status !== "missing")
    .sort(
      ([leftName, left], [rightName, right]) =>
        right.calls - left.calls || leftName.localeCompare(rightName),
    )
    .map(([name, value]) => ({
      name,
      metrics: value,
      ...(report.resources?.tools[name]?.status
        ? { status: report.resources.tools[name].status }
        : {}),
    }));
}

function skillEntries(report: MetricsReport, metrics: MetricSummary) {
  return Object.entries(metrics.skills)
    .filter(([name]) => report.resources?.skills[name]?.status !== "missing")
    .sort(
      ([leftName, left], [rightName, right]) =>
        right.reads + right.explicit - left.reads - left.explicit ||
        leftName.localeCompare(rightName),
    )
    .map(([name, value]) => ({
      name,
      metrics: value,
      ...(report.resources?.skills[name]?.status
        ? { status: report.resources.skills[name].status }
        : {}),
    }));
}

function modelEntries(metrics: MetricSummary) {
  return Object.entries(metrics.modelEfforts)
    .sort(
      ([leftName, left], [rightName, right]) =>
        right.usage.total - left.usage.total || leftName.localeCompare(rightName),
    )
    .map(([name, metrics]) => ({ name, metrics }));
}

function actionEntries(metrics: MetricSummary) {
  return Object.entries(metrics.toolActions)
    .flatMap(([tool, actions]) =>
      Object.entries(actions).map(([action, metrics]) => ({ tool, action, metrics })),
    )
    .sort(
      (left, right) =>
        right.metrics.calls - left.metrics.calls ||
        left.tool.localeCompare(right.tool) ||
        left.action.localeCompare(right.action),
    );
}

export function selectReport(
  report: MetricsReport,
  options: Partial<MetricsQuery> = {},
): SelectionResult {
  const view = options.view ?? "summary";
  const since = validSince(options.since);
  const limit = validLimit(options.limit);
  const query: MetricsQuery = {
    view,
    ...(since ? { since } : {}),
    ...(limit ? { limit } : {}),
    ...(options.source ? { source: options.source } : {}),
  };
  const metrics = selectedMetrics(report, since);

  if (view === "summary") return { query, data: { kind: "summary", metrics } };
  if (view === "logical-operations")
    return { query, data: { kind: view, metrics: metrics.logicalOperations } };
  if (view === "daily" || view === "weekly" || view === "monthly") {
    return {
      query,
      data: {
        kind: "period",
        period: view,
        rows: rows(
          periodEntries(report, view, since).map(([period, values]) => ({
            period,
            metrics: values,
          })),
          limit,
        ),
      },
    };
  }
  if (view === "projects") {
    return {
      query,
      data: {
        kind: view,
        rows: rows(
          Object.entries(report.projects)
            .sort(
              ([leftName, left], [rightName, right]) =>
                right.tokens.total - left.tokens.total || leftName.localeCompare(rightName),
            )
            .map(([project, values]) => ({ project, metrics: values })),
          limit,
        ),
      },
    };
  }
  if (view === "models")
    return { query, data: { kind: view, rows: rows(modelEntries(metrics), limit) } };
  if (view === "skills")
    return { query, data: { kind: view, rows: rows(skillEntries(report, metrics), limit) } };
  if (view === "tools")
    return { query, data: { kind: view, rows: rows(toolEntries(report, metrics), limit) } };
  return { query, data: { kind: view, rows: rows(actionEntries(metrics), limit) } };
}
