import {
  createMetrics,
  mergeMetrics,
  type MetricSummary,
  type MetricsReport,
  type SkillMetrics,
  type ToolMetrics,
} from "./analyze.ts";

export type ReportView =
  | "summary"
  | "daily"
  | "weekly"
  | "projects"
  | "models"
  | "skills"
  | "tools"
  | "tool-actions";

export interface ReportOptions {
  view?: ReportView | undefined;
  since?: string | undefined;
  limit?: number | undefined;
}

export interface ReportSection {
  title: string;
  markdown: string;
  text?: string | undefined;
}

function number(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

export function formatTokens(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return number(value);
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function duration(value: number): string {
  if (value <= 0) return "—";
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)}s`;
  return `${Math.round(value)}ms`;
}

function costPerMTokens(cost: number, tokens: number): string {
  return tokens > 0 ? `$${((cost / tokens) * 1_000_000).toFixed(4)}` : "—";
}

function cacheHitPercent(metrics: MetricSummary): number {
  const prompt = metrics.tokens.input + metrics.tokens.cacheRead;
  return prompt > 0 ? (100 * metrics.tokens.cacheRead) / prompt : 0;
}

const BAR_LEVELS = [
  "  ",
  "▏ ",
  "▎ ",
  "▍ ",
  "▌ ",
  "▋ ",
  "▊ ",
  "▉ ",
  "█ ",
  "█▏",
  "█▎",
  "█▍",
  "█▌",
  "█▋",
  "█▊",
  "█▉",
  "██",
];

function bar(value: number, maximum: number, width = 10): string {
  if (maximum <= 0 || value <= 0) return BAR_LEVELS[0]!.repeat(width);
  const scaled = Math.max(0, Math.min(1, value / maximum)) * width;
  const full = Math.min(width, Math.floor(scaled));
  const fraction = scaled - full;
  const partial =
    full < width && fraction > 0
      ? BAR_LEVELS[Math.max(1, Math.round(fraction * (BAR_LEVELS.length - 1)))]!
      : "";
  return `${BAR_LEVELS.at(-1)!.repeat(full)}${partial}${BAR_LEVELS[0]!.repeat(Math.max(0, width - full - (partial ? 1 : 0)))}`;
}

function validSince(since?: string): string | undefined {
  if (!since) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || Number.isNaN(Date.parse(`${since}T00:00:00Z`)))
    throw new Error(`Invalid --since date: ${since}`);
  return since;
}

function limitValue(limit?: number): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
  return limit;
}

function rows<T>(items: T[], limit?: number): T[] {
  return limit === undefined ? items : items.slice(0, limit);
}

function title(text: string): string {
  return `## ${text}`;
}

function markdownTable(headers: string[], values: Array<Array<string | number>>): string[] {
  const escape = (value: string | number): string => String(value).replaceAll("|", "\\|");
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...values.map((row) => `| ${row.map(escape).join(" | ")} |`),
  ];
}

function tokenDetails(metrics: MetricSummary): string {
  const promptInput = metrics.tokens.input + metrics.tokens.cacheRead;
  return markdownTable(
    [
      "Prompt input",
      "Cache hit",
      "Cached",
      "Uncached",
      "Cache write",
      "Output",
      "Reasoning",
      "Cache cost",
    ],
    [
      [
        formatTokens(promptInput),
        `${cacheHitPercent(metrics).toFixed(1)}%`,
        formatTokens(metrics.tokens.cacheRead),
        formatTokens(metrics.tokens.input),
        formatTokens(metrics.tokens.cacheWrite),
        formatTokens(metrics.tokens.output),
        formatTokens(metrics.tokens.reasoning),
        money(metrics.tokens.cacheCost),
      ],
    ],
  ).join("\n");
}

function metricRows(metrics: MetricSummary, activeDays = 0): string[] {
  return markdownTable(
    [
      "Sessions",
      "Active days",
      "Turns",
      "Messages",
      "Tools",
      "Tokens",
      "Cost",
      "Tool errors",
      "Model errors",
      "Invalid JSONL",
    ],
    [
      [
        number(metrics.sessions),
        number(activeDays),
        number(metrics.turns),
        number(metrics.messages),
        number(metrics.toolCalls),
        formatTokens(metrics.tokens.total),
        money(metrics.tokens.cost),
        number(metrics.toolErrors),
        number(metrics.modelErrors),
        number(metrics.invalidLines),
      ],
    ],
  );
}

function reportIsoWeekKey(timestamp: string): string {
  const date = new Date(timestamp);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function periodEntries(report: MetricsReport, view: "daily" | "weekly", since?: string) {
  const minimum = since && view === "weekly" ? reportIsoWeekKey(`${since}T00:00:00Z`) : since;
  return Object.entries(report[view])
    .filter(([key]) => !minimum || key >= minimum)
    .sort(([left], [right]) => right.localeCompare(left));
}

function summaryFor(
  report: MetricsReport,
  since?: string,
): { metrics: MetricSummary; activeDays: number } {
  const daily = periodEntries(report, "daily", since);
  return {
    metrics: since
      ? daily.reduce((total, [, metrics]) => mergeMetrics(total, metrics), createMetrics())
      : report,
    activeDays: daily.length,
  };
}

function modelRows(metrics: MetricSummary, limit?: number) {
  return rows(
    Object.entries(metrics.modelEfforts).sort(
      ([leftName, left], [rightName, right]) =>
        right.usage.total - left.usage.total || leftName.localeCompare(rightName),
    ),
    limit,
  );
}

function toolRows(report: MetricsReport, metrics: MetricSummary, limit?: number) {
  return rows(
    Object.entries(metrics.toolUsage)
      .filter(([name]) => report.resources?.tools[name]?.status !== "missing")
      .sort(
        ([leftName, left], [rightName, right]) =>
          right.calls - left.calls || leftName.localeCompare(rightName),
      ),
    limit,
  );
}

function skillRows(report: MetricsReport, metrics: MetricSummary, limit?: number) {
  return rows(
    Object.entries(metrics.skills)
      .filter(([name]) => report.resources?.skills[name]?.status !== "missing")
      .sort(
        ([leftName, left], [rightName, right]) =>
          right.reads + right.explicit - left.reads - left.explicit ||
          leftName.localeCompare(rightName),
      ),
    limit,
  );
}

function emptyTool(): ToolMetrics {
  return {
    calls: 0,
    estimatedResultTokens: 0,
    reportedTokens: 0,
    errors: 0,
    completedCalls: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
  };
}

function emptySkill(): SkillMetrics {
  return { reads: 0, explicit: 0 };
}

const ACTIVITY_CHART_LEVELS = [
  "  ",
  "▏ ",
  "▎ ",
  "▍ ",
  "▌ ",
  "▋ ",
  "▊ ",
  "▉ ",
  "█ ",
  "█▏",
  "█▎",
  "█▍",
  "█▌",
  "█▋",
  "█▊",
];

function activityChart(entries: Array<[string, MetricSummary]>): string {
  if (entries.length === 0) return "Recent activity (tokens, 30 days)\n(no activity)";
  const byDate = new Map(entries);
  const end = new Date(`${entries[0]![0]}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 29);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const points: Array<[string, MetricSummary]> = [];
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const key = date.toISOString().slice(0, 10);
    points.push([key, byDate.get(key) ?? createMetrics()]);
  }
  const maximum = Math.max(...points.map(([, metrics]) => metrics.tokens.total), 0);
  const weekdays = ["S", "M", "T", "W", "T", "F", "S"];
  const weeks = Math.ceil(points.length / 7);
  const cell = (value: number): string => {
    if (maximum <= 0 || value <= 0) return ACTIVITY_CHART_LEVELS[0]!;
    return ACTIVITY_CHART_LEVELS[
      Math.max(1, Math.round((value / maximum) * (ACTIVITY_CHART_LEVELS.length - 1)))
    ]!;
  };
  return [
    "Recent activity (tokens, 30 days)",
    ...weekdays.map(
      (weekday, weekdayIndex) =>
        `${weekday} ${Array.from({ length: weeks }, (_, weekIndex) => {
          const point = points[weekIndex * 7 + weekdayIndex];
          return point ? cell(point[1].tokens.total) : ACTIVITY_CHART_LEVELS[0]!;
        }).join("")}`,
    ),
  ].join("\n");
}

function renderModelTable(metrics: MetricSummary, limit?: number): string {
  const entries = modelRows(metrics, limit);
  return [
    title("Top models / effort"),
    ...markdownTable(
      ["Model", "Effort", "Messages", "Tokens", "Cost", "$/1M tokens"],
      entries.map(([, value]) => [
        value.model,
        value.effort,
        number(value.messages),
        formatTokens(value.usage.total),
        money(value.usage.cost),
        costPerMTokens(value.usage.cost, value.usage.total),
      ]),
    ),
  ].join("\n");
}

function renderToolTable(report: MetricsReport, metrics: MetricSummary, limit?: number): string {
  const names = new Set([
    ...Object.keys(metrics.toolUsage),
    ...Object.keys(report.resources?.tools ?? {}),
  ]);
  const entries = rows(
    [...names]
      .filter((name) => report.resources?.tools[name]?.status !== "missing")
      .map((name) => [name, metrics.toolUsage[name] ?? emptyTool()] as const)
      .sort(
        ([leftName, left], [rightName, right]) =>
          right.calls - left.calls || leftName.localeCompare(rightName),
      ),
    limit,
  );
  return [
    title("Top tools"),
    ...(report.resources ? [`Current inventory scope: ${report.resources.scope}`, ""] : []),
    ...markdownTable(
      [
        "Tool",
        "Status",
        "Calls",
        "Errors",
        "Estimated result",
        "Reported result",
        "Avg latency",
        "Max latency",
      ],
      entries.map(([tool, value]) => [
        tool,
        report.resources?.tools[tool]?.status ?? "—",
        number(value.calls),
        number(value.errors),
        formatTokens(value.estimatedResultTokens),
        formatTokens(value.reportedTokens),
        duration(value.completedCalls > 0 ? value.totalDurationMs / value.completedCalls : 0),
        duration(value.maxDurationMs),
      ]),
    ),
  ].join("\n");
}

function renderSkillTable(report: MetricsReport, metrics: MetricSummary, limit?: number): string {
  const names = new Set([
    ...Object.keys(metrics.skills),
    ...Object.keys(report.resources?.skills ?? {}),
  ]);
  const entries = rows(
    [...names]
      .filter((name) => report.resources?.skills[name]?.status !== "missing")
      .map((name) => [name, metrics.skills[name] ?? emptySkill()] as const)
      .sort(
        ([leftName, left], [rightName, right]) =>
          right.reads + right.explicit - left.reads - left.explicit ||
          leftName.localeCompare(rightName),
      ),
    limit,
  );
  return [
    title("Top skills"),
    ...(report.resources ? [`Current inventory scope: ${report.resources.scope}`, ""] : []),
    ...markdownTable(
      ["Skill", "Status", "Reads", "Explicit", "Total"],
      entries.map(([skill, value]) => [
        skill,
        report.resources?.skills[skill]?.status ?? "—",
        number(value.reads),
        number(value.explicit),
        number(value.reads + value.explicit),
      ]),
    ),
  ].join("\n");
}

function renderToolActionTable(metrics: MetricSummary, limit?: number): string {
  const entries = rows(
    Object.entries(metrics.toolActions)
      .flatMap(([tool, actions]) =>
        Object.entries(actions).map(([action, usage]) => ({ tool, action, usage })),
      )
      .sort(
        (left, right) =>
          right.usage.calls - left.usage.calls ||
          left.tool.localeCompare(right.tool) ||
          left.action.localeCompare(right.action),
      ),
    limit,
  );
  return [
    title("Tool actions"),
    ...markdownTable(
      ["Tool", "Action", "Calls", "Errors", "Estimated result", "Avg latency", "Max latency"],
      entries.map(({ tool, action, usage }) => [
        tool,
        action,
        number(usage.calls),
        number(usage.errors),
        formatTokens(usage.estimatedResultTokens),
        duration(usage.completedCalls > 0 ? usage.totalDurationMs / usage.completedCalls : 0),
        duration(usage.maxDurationMs),
      ]),
    ),
  ].join("\n");
}

function renderPeriod(
  report: MetricsReport,
  view: "daily" | "weekly",
  since: string | undefined,
  limit: number | undefined,
): string {
  const entries = rows(periodEntries(report, view, since), limit);
  return [
    title(view === "daily" ? "Daily activity" : "Weekly activity"),
    ...markdownTable(
      ["Period", "Sessions", "Turns", "Messages", "Tokens", "Cost", "Errors", "Cost/turn"],
      entries.map(([key, metrics]) => [
        key,
        number(metrics.sessions),
        number(metrics.turns),
        number(metrics.messages),
        formatTokens(metrics.tokens.total),
        money(metrics.tokens.cost),
        number(metrics.errors),
        metrics.turns > 0 ? money(metrics.tokens.cost / metrics.turns) : "—",
      ]),
    ),
  ].join("\n");
}

function renderProjectTable(report: MetricsReport, limit?: number): string {
  const entries = rows(
    Object.entries(report.projects).sort(
      ([leftName, left], [rightName, right]) =>
        right.tokens.total - left.tokens.total || leftName.localeCompare(rightName),
    ),
    limit,
  );
  return [
    title("Top projects"),
    ...markdownTable(
      ["Project", "Sessions", "Turns", "Tokens", "Cost", "Errors"],
      entries.map(([project, metrics]) => [
        project,
        number(metrics.sessions),
        number(metrics.turns),
        formatTokens(metrics.tokens.total),
        money(metrics.tokens.cost),
        number(metrics.errors),
      ]),
    ),
  ].join("\n");
}

function summarySections(report: MetricsReport, options: ReportOptions): ReportSection[] {
  const since = validSince(options.since);
  const limit = limitValue(options.limit);
  const { metrics, activeDays } = summaryFor(report, since);
  const models = modelRows(metrics, limit);
  const tools = toolRows(report, metrics, limit);
  const skills = skillRows(report, metrics, limit);
  const maxModelTokens = Math.max(...models.map(([, value]) => value.usage.total), 0);
  const maxToolCalls = Math.max(...tools.map(([, value]) => value.calls), 0);
  const maxSkillUses = Math.max(...skills.map(([, value]) => value.reads + value.explicit), 0);
  return [
    {
      title: "Session Metrics",
      markdown: `${metricRows(metrics, activeDays).join("\n")}\n\n${tokenDetails(metrics)}`,
      text: activityChart(periodEntries(report, "daily", since)),
    },
    {
      title: "Top model / effort",
      markdown: markdownTable(
        ["Model", "Effort", "Activity", "Messages", "Tokens", "Cost"],
        models.map(([, value]) => [
          value.model,
          value.effort,
          bar(value.usage.total, maxModelTokens),
          number(value.messages),
          formatTokens(value.usage.total),
          money(value.usage.cost),
        ]),
      ).join("\n"),
    },
    {
      title: "Top skills",
      markdown: markdownTable(
        ["Skill", "Activity", "Reads", "Explicit", "Total"],
        skills.map(([skill, value]) => [
          skill,
          bar(value.reads + value.explicit, maxSkillUses),
          number(value.reads),
          number(value.explicit),
          number(value.reads + value.explicit),
        ]),
      ).join("\n"),
    },
    {
      title: "Top tools",
      markdown: markdownTable(
        [
          "Tool",
          "Activity",
          "Calls",
          "Errors",
          "Estimated result",
          "Reported result",
          "Avg latency",
          "Max latency",
        ],
        tools.map(([tool, value]) => [
          tool,
          bar(value.calls, maxToolCalls),
          number(value.calls),
          number(value.errors),
          formatTokens(value.estimatedResultTokens),
          formatTokens(value.reportedTokens),
          duration(value.completedCalls > 0 ? value.totalDurationMs / value.completedCalls : 0),
          duration(value.maxDurationMs),
        ]),
      ).join("\n"),
    },
  ];
}

function renderView(report: MetricsReport, options: ReportOptions): string {
  const since = validSince(options.since);
  const limit = limitValue(options.limit);
  const view = options.view ?? "summary";
  const { metrics } = summaryFor(report, since);
  if (view === "daily" || view === "weekly") return renderPeriod(report, view, since, limit);
  if (view === "projects") return renderProjectTable(report, limit);
  if (view === "models") return renderModelTable(metrics, limit);
  if (view === "skills") return renderSkillTable(report, metrics, limit);
  if (view === "tools") return renderToolTable(report, metrics, limit);
  if (view === "tool-actions") return renderToolActionTable(metrics, limit);
  return summarySections(report, options)
    .map(
      (section) =>
        `${title(section.title)}\n${section.markdown}${section.text ? `\n\n${section.text}` : ""}`,
    )
    .join("\n\n");
}

export function reportSections(
  report: MetricsReport,
  options: ReportOptions = {},
): ReportSection[] {
  if ((options.view ?? "summary") === "summary") return summarySections(report, options);
  const markdown = renderView(report, options);
  const [heading, ...rest] = markdown.split("\n");
  return [{ title: heading?.replace(/^## /, "") ?? "Session Metrics", markdown: rest.join("\n") }];
}

export function renderSummary(report: MetricsReport, options: ReportOptions = {}): string {
  return renderView(report, options);
}
