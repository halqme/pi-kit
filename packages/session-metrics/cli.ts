#!/usr/bin/env bun
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDatabaseReport } from "./src/database-report.ts";
import { reportSections, type ReportOptions, type ReportView } from "./src/report.ts";
import { ingestSessions, queryDatabase, showStats } from "./src/storage.ts";

interface CliOptions extends ReportOptions {
  command: "report" | "ingest" | "stats" | "query";
  json: boolean;
  target: string;
  database?: string | undefined;
  sql?: string | undefined;
}

function usage(): string {
  return `Usage: session-metrics [path] [options]\n\nCommands:\n  ingest [path]       Incrementally import JSONL files into DuckDB\n  stats               Show stored table counts\n  query "SQL"         Run SQL against the DuckDB database\n\nOptions:\n  --json              Output the compatible MetricsReport JSON\n  --daily             Show daily activity\n  --weekly            Show weekly activity\n  --projects          Show project ranking\n  --models            Show model / effort ranking
  --skills            Show skill ranking\n  --tools             Show tool ranking\n  --since YYYY-MM-DD  Filter activity from this UTC date\n  --limit N           Limit rows\n  --db PATH           DuckDB database path\n  --help              Show this help`;
}

function parseArgs(args: string[]): CliOptions {
  let command: CliOptions["command"] = "report";
  let target = join(homedir(), ".pi", "agent", "sessions");
  let view: ReportView = "summary";
  let json = false;
  let since: string | undefined;
  let limit: number | undefined;
  let database: string | undefined;
  let sql: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") throw new Error(usage());
    if (arg === "--json") json = true;
    else if (arg === "--daily") view = "daily";
    else if (arg === "--weekly") view = "weekly";
    else if (arg === "--projects") view = "projects";
    else if (arg === "--models") view = "models";
    else if (arg === "--skills") view = "skills";
    else if (arg === "--tools") view = "tools";
    else if (arg === "--since") since = args[++i];
    else if (arg === "--limit") limit = Number(args[++i]);
    else if (arg === "--db") database = args[++i];
    else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
    else positional.push(arg);
  }
  if (["ingest", "stats", "query"].includes(positional[0] ?? "")) {
    command = positional.shift() as CliOptions["command"];
  }
  if (command === "query") sql = positional.join(" ");
  else if (positional[0]) target = positional[0];
  if (command === "query" && !sql) throw new Error("query requires a SQL argument");
  if (command !== "report" && (json || view !== "summary" || since || limit !== undefined))
    throw new Error("Report display options cannot be used with this command");
  return { command, target, view, json, since, limit, database, sql };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(args);
  if (options.command === "report") {
    const result = await buildDatabaseReport(options.database, options.since, options.limit);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      const output = reportSections(result, options)
        .map((section) => {
          const table = Bun.markdown.ansi(section.markdown, { columns: 0 });
          return `\x1b[1;36m${section.title}\x1b[0m\n${table}${section.text ? `\n\n${section.text}` : ""}`;
        })
        .join("\n\n");
      process.stdout.write(`${output}\n`);
    }
    return;
  }
  if (options.command === "ingest") {
    const result = await ingestSessions(options.target, options.database);
    console.log(`Indexed ${result.indexed} file(s), skipped ${result.skipped} unchanged file(s).`);
    return;
  }
  if (options.command === "stats") {
    console.log(await showStats(options.database));
    return;
  }
  console.log(await queryDatabase(options.sql!, options.database));
}

if (basename(process.argv[1] ?? "") === basename(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message === usage()) console.log(message);
    else {
      console.error(`session-metrics: ${message}`);
      process.exitCode = 1;
    }
  });
}
