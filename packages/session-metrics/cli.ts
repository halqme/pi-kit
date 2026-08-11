import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport } from "./src/build-report.ts";
import { selectReport, type QueryView } from "./src/selection.ts";
import { addCurrentResources } from "./src/resources.ts";

type CliOptions = {
  view?: QueryView;
  since?: string;
  limit?: number;
  target: string;
};

function usage(): string {
  return `Usage: session-metrics [path] [options]\n\nOptions:\n  --daily             Show daily activity\n  --weekly            Show weekly activity\n  --monthly           Show monthly activity\n  --projects          Show project ranking\n  --models            Show model / effort ranking\n  --skills            Show skill usage and current status\n  --tools             Show tool usage, latency, and current status\n  --tool-actions      Show action facets within tools\n  --logical-operations Show logical operation totals\n  --since YYYY-MM-DD  Filter activity from this UTC date\n  --limit N           Limit result rows\n  --help              Show this help\n\nOutput:\n  JSON only. --since filters sessions; --limit limits result rows.`;
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
        "--daily",
        "--weekly",
        "--monthly",
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

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  const report = await buildReport(options.target, options.since);
  if (options.view === "skills" || options.view === "tools" || options.view === "tool-actions") {
    await addCurrentResources(report, process.cwd());
  }
  process.stdout.write(
    `${JSON.stringify(selectReport(report, { ...options, source: options.target }), null, 2)}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(`session-metrics: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
