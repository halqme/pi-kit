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
  | "tools";

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
  return new Intl.NumberFormat("en-US").format(value);
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

function costPerMTokens(cost: number, tokens: number): string {
  return tokens > 0 ? `$${((cost / tokens) * 1_000_000).toFixed(4)}` : "—";
}

const BRAILLE_LEVELS = [
  "  ",
  "▏ ",
  "▎ ",
  "▍ ",
  "▌ ",
  "▋ ",
  "▊ ",
  "▉ ",
  "█ ",
  "█ ",
  "█▏",
  "█▎",
  "█▍",
  "█▌",
  "█▋",
  "█▊",
  "█▉",
  "██",
  "██",
];

function brailleLevel(levels: string[], fraction: number): string {
  const index = Math.max(
    0,
    Math.min(levels.length - 1, Math.round(fraction * (levels.length - 1))),
  );
  return levels[index]!;
}

function bar(value: number, maximum: number, width = 10): string {
  if (maximum <= 0) return BRAILLE_LEVELS[0]!.repeat(width);
  const scaled = Math.max(0, Math.min(1, value / maximum)) * width;
  let full = Math.floor(scaled);
  const partial = Math.round((scaled - full) * (BRAILLE_LEVELS.length - 1));
  if (partial === BRAILLE_LEVELS.length - 1) full++;
  const hasPartial = partial > 0 && partial < BRAILLE_LEVELS.length - 1 && full < width;
  const remainder = width - full - (hasPartial ? 1 : 0);
  return (
    BRAILLE_LEVELS[BRAILLE_LEVELS.length - 1]!.repeat(full) +
    (hasPartial ? brailleLevel(BRAILLE_LEVELS, scaled - Math.floor(scaled)) : "") +
    BRAILLE_LEVELS[0]!.repeat(Math.max(0, remainder))
  );
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

function availableSkills(report: MetricsReport): Array<[string, SkillMetrics]> {
  const projectNames = new Set(
    Object.values(report.projects).flatMap((project) =>
      Object.entries(project.skills)
        .filter(([, skill]) => skill.existsInProject === true)
        .map(([name]) => name),
    ),
  );
  return Object.entries(report.skills).filter(
    ([name, skill]) => skill.existsGlobally === true || projectNames.has(name),
  );
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
    ["Input", "Cached", "Uncached", "Output", "Reasoning", "Cache re-billed"],
    [
      [
        formatTokens(promptInput),
        formatTokens(metrics.tokens.cacheRead),
        formatTokens(metrics.tokens.input),
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
      "User",
      "Assistant",
      "Tool results",
      "Tokens",
      "Cost",
      "Errors",
    ],
    [
      [
        number(metrics.sessions),
        number(activeDays),
        number(metrics.turns),
        number(metrics.messages),
        number(metrics.userMessages),
        number(metrics.assistantMessages),
        number(metrics.toolResults),
        formatTokens(metrics.tokens.total),
        money(metrics.tokens.cost),
        number(metrics.errors),
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
    .sort(([a], [b]) => b.localeCompare(a));
}

function renderSummaryMarkdown(report: MetricsReport, options: ReportOptions = {}): string {
  const since = validSince(options.since);
  const limit = limitValue(options.limit);
  const view = options.view ?? "summary";
  if (view === "summary") {
    const daily = periodEntries(report, "daily", since);
    const summary = since
      ? daily.reduce((total, [, metrics]) => mergeMetrics(total, metrics), createMetrics())
      : report;
    const tools = rows(
      Object.entries(summary.toolUsage)
        .filter(([, tool]) => tool.available === true)
        .sort(([a, av], [b, bv]) => bv.calls - av.calls || a.localeCompare(b)),
      limit,
    );
    const modelEfforts = rows(
      Object.entries(summary.modelEfforts).sort(
        ([a, av], [b, bv]) => bv.usage.total - av.usage.total || a.localeCompare(b),
      ),
      limit,
    );
    const skills = rows(
      availableSkills(report).sort(
        ([a, av], [b, bv]) =>
          bv.reads + bv.explicit - (av.reads + av.explicit) || a.localeCompare(b),
      ),
      limit,
    );
    const lines = [
      title("Session Metrics"),
      ...metricRows(summary, daily.length),
      "",
      "### Top model / effort",
      ...markdownTable(
        ["Model", "Effort", "Messages", "Tokens", "Cost"],
        modelEfforts.map(([_, m]) => [
          m.model,
          m.effort,
          number(m.messages),
          formatTokens(m.usage.total),
          money(m.usage.cost),
        ]),
      ),
      "",
      "### Top skills & tools",
      ...markdownTable(
        ["Skill", "Reads", "Explicit", "Tool", "Calls", "Result tokens"],
        Array.from({ length: Math.max(skills.length, tools.length) }, (_, index) => {
          const skill = skills[index];
          const tool = tools[index];
          return [
            skill?.[0] ?? "",
            skill ? number(skill[1].reads) : "",
            skill ? number(skill[1].explicit) : "",
            tool?.[0] ?? "",
            tool ? number(tool[1].calls) : "",
            tool ? formatTokens(tool[1].reportedTokens || tool[1].estimatedResultTokens) : "",
          ];
        }),
      ),
    ];
    return lines.join("\n");
  }
  if (view === "daily" || view === "weekly") {
    return renderPeriod(report, view, since, limit);
  }
  if (view === "projects") return renderProjectTable(report, limit);
  if (view === "models") return renderModelEffortTable(report, limit);
  if (view === "skills") return renderSkillTable(report, limit);
  return renderToolTable(report, limit);
}

const ACTIVITY_CELLS = BRAILLE_LEVELS;

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
  const cell = (value: number): string => {
    if (maximum <= 0 || value <= 0) return ACTIVITY_CELLS[0]!;
    return ACTIVITY_CELLS[
      Math.max(1, Math.round((value / maximum) * (ACTIVITY_CELLS.length - 1)))
    ]!;
  };
  const weekdays = ["S", "M", "T", "W", "T", "F", "S"];
  const weeks = Math.ceil(points.length / 7);
  const lines = ["Recent activity (tokens, 30 days)"];
  for (const [weekdayIndex, weekday] of weekdays.entries()) {
    lines.push(
      `${weekday} ${Array.from({ length: weeks }, (_, weekIndex) => {
        const point = points[weekIndex * 7 + weekdayIndex];
        return point ? cell(point[1].tokens.total) : ACTIVITY_CELLS[0]!;
      }).join("")}`,
    );
  }
  return lines.join("\n");
}

function summarySections(report: MetricsReport, options: ReportOptions): ReportSection[] {
  const since = validSince(options.since);
  const limit = limitValue(options.limit);
  const daily = periodEntries(report, "daily", since);
  const summary = since
    ? daily.reduce((total, [, metrics]) => mergeMetrics(total, metrics), createMetrics())
    : report;
  const modelEfforts = rows(
    Object.entries(summary.modelEfforts).sort(
      ([a, av], [b, bv]) => bv.usage.total - av.usage.total || a.localeCompare(b),
    ),
    limit,
  );
  const skills = rows(
    availableSkills(report).sort(
      ([a, av], [b, bv]) => bv.reads + bv.explicit - (av.reads + av.explicit) || a.localeCompare(b),
    ),
    limit,
  );
  const tools = rows(
    Object.entries(summary.toolUsage)
      .filter(([, tool]) => tool.available === true)
      .sort(([a, av], [b, bv]) => bv.calls - av.calls || a.localeCompare(b)),
    limit,
  );
  const maxEffortTokens = Math.max(...modelEfforts.map(([, value]) => value.usage.total), 0);
  const maxSkillUsage = Math.max(...skills.map(([, value]) => value.reads + value.explicit), 0);
  const maxToolUsage = Math.max(...tools.map(([, value]) => value.calls), 0);
  return [
    {
      title: "Session Metrics",
      markdown: `${metricRows(summary, daily.length).join("\n")}\n\n${tokenDetails(summary)}`,
      text: activityChart(daily),
    },
    {
      title: "Top model / effort",
      markdown: markdownTable(
        ["Model", "Effort", "Activity", "Messages", "Tokens", "Cost", "$/1M tokens"],
        modelEfforts.map(([_, m]) => [
          m.model,
          m.effort,
          bar(m.usage.total, maxEffortTokens),
          number(m.messages),
          formatTokens(m.usage.total),
          money(m.usage.cost),
          costPerMTokens(m.usage.cost, m.usage.total),
        ]),
      ).join("\n"),
    },
    {
      title: "Top skills & tools",
      markdown: markdownTable(
        ["Skill", "Reads", "Explicit", "Activity", "Tool", "Calls", "Result tokens", "Activity"],
        Array.from({ length: Math.max(skills.length, tools.length) }, (_, index) => {
          const skill = skills[index];
          const tool = tools[index];
          return [
            skill?.[0] ?? "",
            skill ? number(skill[1].reads) : "",
            skill ? number(skill[1].explicit) : "",
            skill ? bar(skill[1].reads + skill[1].explicit, maxSkillUsage) : "",
            tool?.[0] ?? "",
            tool ? number(tool[1].calls) : "",
            tool ? formatTokens(tool[1].reportedTokens || tool[1].estimatedResultTokens) : "",
            tool ? bar(tool[1].calls, maxToolUsage) : "",
          ];
        }),
      ).join("\n"),
    },
  ];
}

export function reportSections(
  report: MetricsReport,
  options: ReportOptions = {},
): ReportSection[] {
  if ((options.view ?? "summary") === "summary") return summarySections(report, options);
  const markdown = renderSummaryMarkdown(report, options);
  const [heading, ...rest] = markdown.split("\n");
  return [{ title: heading?.replace(/^## /, "") ?? "Session Metrics", markdown: rest.join("\n") }];
}

export function renderSummary(report: MetricsReport, options: ReportOptions = {}): string {
  return reportSections(report, options)
    .map(
      (section) =>
        `${title(section.title)}\n${section.markdown}${section.text ? `\n\n${section.text}` : ""}`,
    )
    .join("\n\n");
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
      ["Period", "Sessions", "Turns", "Messages", "Tokens", "Cost", "Errors", "Avg/turn"],
      entries.map(([key, m]) => [
        key,
        number(m.sessions),
        number(m.turns),
        number(m.messages),
        formatTokens(m.tokens.total),
        money(m.tokens.cost),
        number(m.errors),
        m.turns > 0 ? money(m.tokens.cost / m.turns) : "—",
      ]),
    ),
  ].join("\n");
}

function renderProjectTable(report: MetricsReport, limit: number | undefined): string {
  const entries = rows(
    Object.entries(report.projects).sort(
      ([a, av], [b, bv]) => bv.tokens.total - av.tokens.total || a.localeCompare(b),
    ),
    limit,
  );
  return [
    title("Top projects"),
    ...markdownTable(
      ["Project", "Sessions", "Turns", "Messages", "Tokens", "Cost", "Errors", "Avg/turn"],
      entries.map(([project, value]) => [
        project,
        number(value.sessions),
        number(value.turns),
        number(value.messages),
        formatTokens(value.tokens.total),
        money(value.tokens.cost),
        number(value.errors),
        value.turns > 0 ? money(value.tokens.cost / value.turns) : "—",
      ]),
    ),
  ].join("\n");
}

function renderSkillTable(report: MetricsReport, limit: number | undefined): string {
  const entries = rows(
    availableSkills(report).sort(
      ([a, av], [b, bv]) => bv.reads + bv.explicit - av.reads - av.explicit || a.localeCompare(b),
    ),
    limit,
  );
  return [
    title("Top skills"),
    ...markdownTable(
      ["Skill", "Reads", "Explicit", "Total", "Global", "Project"],
      entries.map(([skill, value]) => [
        skill,
        number(value.reads),
        number(value.explicit),
        number(value.reads + value.explicit),
        value.existsGlobally === undefined ? "—" : value.existsGlobally ? "yes" : "missing",
        value.existsInProject === undefined ? "—" : value.existsInProject ? "yes" : "missing",
      ]),
    ),
  ].join("\n");
}

function renderModelEffortTable(report: MetricsReport, limit: number | undefined): string {
  const entries = rows(
    Object.entries(report.modelEfforts).sort(
      ([a, av], [b, bv]) => bv.usage.total - av.usage.total || a.localeCompare(b),
    ),
    limit,
  );
  return [
    title("Top models / effort"),
    ...markdownTable(
      ["Model", "Effort", "Messages", "Tokens", "Cost", "$/1M tokens"],
      entries.map(([_, value]) => [
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

function renderToolTable(report: MetricsReport, limit: number | undefined): string {
  const entries = rows(
    Object.entries(report.toolUsage)
      .filter(([, tool]) => tool.available === true)
      .sort(([a, av], [b, bv]) => bv.calls - av.calls || a.localeCompare(b)),
    limit,
  );
  return [
    title("Top tools"),
    ...markdownTable(
      ["Tool", "Calls", "Estimated result", "Reported tokens", "Errors", "Avg result/call"],
      entries.map(([tool, value]: [string, ToolMetrics]) => [
        tool,
        number(value.calls),
        formatTokens(value.estimatedResultTokens),
        formatTokens(value.reportedTokens),
        number(value.errors),
        value.calls > 0 ? formatTokens(value.estimatedResultTokens / value.calls) : "—",
      ]),
    ),
  ].join("\n");
}
