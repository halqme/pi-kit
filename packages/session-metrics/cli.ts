import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport } from "./src/build-report.ts";
import {
  selectReport,
  type QueryView,
  type SelectionData,
  type SelectionResult,
} from "./src/selection.ts";
import { addCurrentResources } from "./src/resources.ts";

type CliOptions = {
  view?: QueryView;
  since?: string;
  limit?: number;
  target: string;
};

function usage(): string {
  return `Usage: session-metrics [path] [options]\n\nOptions:\n  --all               Output the complete selected report\n  --daily             Show daily activity\n  --weekly            Show weekly activity\n  --monthly           Show monthly activity\n  --monthly-activity  Show monthly activity rows\n  --projects          Show project ranking\n  --models            Show model / effort ranking\n  --skills            Show skill usage and current status\n  --tools             Show tool usage, latency, and current status\n  --tool-actions      Show action facets within tools\n  --logical-operations Show logical operation totals\n  --since YYYY-MM-DD  Filter activity from this UTC date\n  --limit N           Limit result rows\n  --help              Show this help\n\nOutput:\n  No options: compact TUI overview. Any option: canonical JSON. --since filters sessions; --limit limits result rows.`;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    target: join(homedir(), ".pi", "agent", "sessions"),
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === "--help") throw new Error(usage());
    if (
      [
        "--all",
        "--daily",
        "--weekly",
        "--monthly",
        "--monthly-activity",
        "--projects",
        "--models",
        "--skills",
        "--tools",
        "--tool-actions",
        "--logical-operations",
      ].includes(arg)
    )
      options.view = arg.slice(2) as QueryView;
    else if (arg === "--since") {
      const value = args[++index];
      if (value === undefined) throw new Error("--since requires a date");
      options.since = value;
    } else if (arg === "--limit") {
      const value = args[++index];
      if (value === undefined) throw new Error("--limit requires a number");
      options.limit = Number(value);
    } else if (!arg.startsWith("-")) options.target = arg;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function activityGrass(data: Extract<SelectionData, { kind: "overview" }>): string {
  const entries = data.dailyActivity;
  if (entries.length === 0) return "Recent activity (tokens, 30 days)\n(no activity)";
  const byDate = new Map(entries.map((entry) => [entry.period, entry.metrics.tokens.total]));
  const end = new Date(`${entries[0]!.period}T00:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 29);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const points: Array<[string, number]> = [];
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const key = date.toISOString().slice(0, 10);
    points.push([key, byDate.get(key) ?? 0]);
  }
  const maximum = Math.max(...points.map(([, value]) => value), 0);
  const levels = [
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
  ];
  const weekdays = ["S", "M", "T", "W", "T", "F", "S"];
  const weeks = Math.ceil(points.length / 7);
  const cell = (value: number): string => {
    if (maximum <= 0 || value <= 0) return levels[0]!;
    return levels[Math.max(1, Math.round((value / maximum) * (levels.length - 1)))]!;
  };
  return [
    "Recent activity (tokens, 30 days)",
    ...weekdays.map(
      (weekday, weekdayIndex) =>
        `${weekday} ${Array.from({ length: weeks }, (_, weekIndex) => {
          const point = points[weekIndex * 7 + weekdayIndex];
          return point ? cell(point[1]) : levels[0]!;
        }).join("")}`,
    ),
  ].join("\n");
}

function renderOverview(selection: SelectionResult): string {
  if (selection.data.kind !== "overview") throw new Error("Overview data is not selected");
  const { metrics, tools, skills, models } = selection.data;
  const section = (name: string): string => `\n\x1b[1;33m${name}\x1b[0m`;
  return [
    "\x1b[1;36mSession Metrics\x1b[0m",
    `Sessions ${formatCount(metrics.sessions)}  Turns ${formatCount(metrics.turns)}  Tokens ${formatCount(metrics.tokens.total)}  Errors ${formatCount(metrics.errors)}`,
    section("Activity"),
    activityGrass(selection.data),
    section("Tools by frequency (top 10)"),
    ...(tools.length > 0
      ? tools.map(
          (tool) =>
            `  ${tool.name.padEnd(24)} ${formatCount(tool.calls).padStart(7)} calls (${formatPercent(tool.callShare)})`,
        )
      : ["  (no data)"]),
    section("Skills by frequency (top 10)"),
    ...(skills.length > 0
      ? skills.map(
          (skill) =>
            `  ${skill.name.padEnd(24)} ${formatCount(skill.frequency).padStart(7)} uses (${formatPercent(skill.frequencyShare)})`,
        )
      : ["  (no data)"]),
    section("Models"),
    ...(models.length > 0
      ? models.map(
          (model) =>
            `  ${model.provider.padEnd(14)} ${model.model.padEnd(18)} ${model.effort.padEnd(7)} ${formatPercent(model.frequency).padStart(6)}  cache ${formatPercent(model.cacheHitRate).padStart(6)}  cost $${model.cost.toFixed(2)}`,
        )
      : ["  (no data)"]),
  ].join("\n");
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  const report = await buildReport(options.target, options.since);
  if (
    options.view === undefined ||
    options.view === "overview" ||
    options.view === "all" ||
    options.view === "skills" ||
    options.view === "tools" ||
    options.view === "tool-actions"
  ) {
    await addCurrentResources(report, process.cwd());
  }
  const selection = selectReport(report, {
    ...options,
    view: options.view ?? "overview",
    source: options.target,
  });
  process.stdout.write(
    args.length === 0
      ? `${renderOverview(selection)}\n`
      : `${JSON.stringify(selection, null, 2)}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(`session-metrics: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
