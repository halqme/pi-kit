import { createMetrics, mergeMetrics } from "./analyze.ts";
import type { MetricsReport, MetricSummary, SourceDiagnostic } from "./types.ts";

export type QueryView =
  | "overview"
  | "summary"
  | "all"
  | "daily"
  | "weekly"
  | "monthly"
  | "monthly-activity"
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
  | {
      kind: "overview";
      metrics: MetricSummary;
      tools: Array<{
        name: string;
        calls: number;
        callShare: number;
        errors: number;
        status?: "available" | "missing" | "unused";
      }>;
      skills: Array<{
        name: string;
        frequency: number;
        frequencyShare: number;
        status?: "available" | "missing" | "unused";
      }>;
      models: Array<{
        name: string;
        provider: string;
        model: string;
        effort: string;
        messages: number;
        frequency: number;
        cacheHitRate: number;
        tokens: number;
        cost: number;
      }>;
      monthlyActivity: Array<{ period: string; metrics: MetricSummary }>;
      dailyActivity: Array<{ period: string; metrics: MetricSummary }>;
    }
  | { kind: "summary"; metrics: MetricSummary }
  | { kind: "all"; report: MetricsReport }
  | { kind: "logical-operations"; metrics: MetricSummary["logicalOperations"] }
  | {
      kind: "period";
      period: "daily" | "weekly" | "monthly";
      rows: Array<{ period: string; metrics: MetricSummary }>;
    }
  | { kind: "monthly-activity"; rows: Array<{ period: string; metrics: MetricSummary }> }
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
        status?: "available" | "missing" | "unused";
      }>;
    };

export interface SelectionResult {
  query: MetricsQuery;
  data: SelectionData;
  source?: SourceDiagnostic;
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
    .map(([, value]) => ({
      name: `${value.provider}/${value.model}/${value.effort}`,
      metrics: value,
    }));
}

function overviewToolEntries(report: MetricsReport, metrics: MetricSummary) {
  return toolEntries(report, metrics).map(({ name, metrics: usage, status }) => ({
    name,
    calls: usage.calls,
    callShare: metrics.toolCalls > 0 ? usage.calls / metrics.toolCalls : 0,
    errors: usage.errors,
    ...(status ? { status } : {}),
  }));
}

function overviewSkillEntries(report: MetricsReport, metrics: MetricSummary) {
  const total = Object.values(metrics.skills).reduce(
    (sum, skill) => sum + skill.reads + skill.explicit,
    0,
  );
  return Object.entries(metrics.skills)
    .filter(([name]) => report.resources?.skills[name]?.status !== "missing")
    .sort(
      ([leftName, left], [rightName, right]) =>
        right.reads + right.explicit - left.reads - left.explicit ||
        leftName.localeCompare(rightName),
    )
    .map(([name, skill]) => ({
      name,
      frequency: skill.reads + skill.explicit,
      frequencyShare: total > 0 ? (skill.reads + skill.explicit) / total : 0,
      ...(report.resources?.skills[name]?.status
        ? { status: report.resources.skills[name].status }
        : {}),
    }));
}

function overviewModelEntries(metrics: MetricSummary) {
  return Object.entries(metrics.modelEfforts)
    .sort(
      ([leftName, left], [rightName, right]) =>
        right.messages - left.messages || leftName.localeCompare(rightName),
    )
    .map(([name, value]) => {
      const prompt = value.usage.input + value.usage.cacheRead;
      return {
        name,
        provider: value.provider,
        model: value.model,
        effort: value.effort,
        messages: value.messages,
        frequency: metrics.assistantMessages > 0 ? value.messages / metrics.assistantMessages : 0,
        cacheHitRate: prompt > 0 ? value.usage.cacheRead / prompt : 0,
        tokens: value.usage.total,
        cost: value.usage.cost,
      };
    });
}

function monthlyActivityEntries(report: MetricsReport, since?: string) {
  return periodEntries(report, "monthly", since).map(([period, metrics]) => ({ period, metrics }));
}

function dailyActivityEntries(report: MetricsReport, since?: string) {
  return periodEntries(report, "daily", since).map(([period, metrics]) => ({ period, metrics }));
}

function actionEntries(report: MetricsReport, metrics: MetricSummary) {
  return Object.entries(metrics.toolActions)
    .flatMap(([tool, actions]) =>
      Object.entries(actions).map(([action, metrics]) => ({
        tool,
        action,
        metrics,
        ...(report.resources?.tools[tool]?.status
          ? { status: report.resources.tools[tool].status }
          : {}),
      })),
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
  const view = options.view ?? "overview";
  const since = validSince(options.since);
  const limit = validLimit(options.limit);
  const query: MetricsQuery = {
    view,
    ...(since ? { since } : {}),
    ...(limit ? { limit } : {}),
    ...(options.source ? { source: options.source } : {}),
  };
  const metrics = selectedMetrics(report, since);
  const frequencyLimit = Math.min(limit ?? 10, 10);
  const result = (data: SelectionData): SelectionResult => ({
    query,
    ...(report.source ? { source: report.source } : {}),
    data,
  });

  if (view === "overview") {
    return result({
      kind: view,
      metrics,
      tools: rows(overviewToolEntries(report, metrics), frequencyLimit),
      skills: rows(overviewSkillEntries(report, metrics), frequencyLimit),
      models: rows(overviewModelEntries(metrics), frequencyLimit),
      monthlyActivity: rows(monthlyActivityEntries(report, since), limit),
      dailyActivity: rows(dailyActivityEntries(report, since), limit),
    });
  }
  if (view === "summary") return result({ kind: "summary", metrics });
  if (view === "all") return result({ kind: view, report });
  if (view === "logical-operations")
    return result({ kind: view, metrics: metrics.logicalOperations });
  if (view === "daily" || view === "weekly" || view === "monthly") {
    return result({
      kind: "period",
      period: view,
      rows: rows(
        periodEntries(report, view, since).map(([period, values]) => ({
          period,
          metrics: values,
        })),
        limit,
      ),
    });
  }
  if (view === "monthly-activity") {
    return result({
      kind: view,
      rows: rows(monthlyActivityEntries(report, since), limit),
    });
  }
  if (view === "projects") {
    return result({
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
    });
  }
  if (view === "models") return result({ kind: view, rows: rows(modelEntries(metrics), limit) });
  if (view === "skills")
    return result({ kind: view, rows: rows(skillEntries(report, metrics), limit) });
  if (view === "tools")
    return result({ kind: view, rows: rows(toolEntries(report, metrics), limit) });
  return result({ kind: view, rows: rows(actionEntries(report, metrics), limit) });
}
