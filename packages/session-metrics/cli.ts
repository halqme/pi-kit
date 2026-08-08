import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport } from "./src/build-report.ts";
import { reportSections, type ReportOptions, type ReportView } from "./src/report.ts";
import { addCurrentResources } from "./src/resources.ts";

type CliOptions = ReportOptions & { json: boolean; target: string };

function usage(): string {
  return `Usage: session-metrics [path] [options]\n\nOptions:\n  --json              Output MetricsReport JSON with current resource inventory\n  --daily             Show daily activity\n  --weekly            Show weekly activity\n  --projects          Show project ranking\n  --models            Show model / effort ranking\n  --skills            Show skill usage and current status\n  --tools             Show tool usage, latency, and current status\n  --tool-actions      Show action facets within tools\n  --since YYYY-MM-DD  Filter activity from this UTC date\n  --limit N           Limit rendered rows\n  --help              Show this help`;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    target: join(homedir(), ".pi", "agent", "sessions"),
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === "--help") throw new Error(usage());
    if (arg === "--json") options.json = true;
    else if (
      ["--daily", "--weekly", "--projects", "--models", "--skills", "--tools", "--tool-actions"].includes(
        arg,
      )
    )
      options.view = arg.slice(2) as ReportView;
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

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  const report = await buildReport(options.target, options.since);
  if (options.json || options.view === "skills" || options.view === "tools") {
    await addCurrentResources(report, process.cwd());
  }
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const output = reportSections(report, options)
    .map(
      (section) =>
        `\x1b[1;36m${section.title}\x1b[0m\n${Bun.markdown.ansi(section.markdown, { columns: 0 })}${section.text ? `\n\n${section.text}` : ""}`,
    )
    .join("\n\n");
  process.stdout.write(`${output}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(`session-metrics: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
