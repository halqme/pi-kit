import { addToReport, analyzeFile, createReport, type MetricsReport } from "./analyze.ts";
import { sessionFiles } from "./files.ts";

/** Builds a deterministic report directly from Pi session JSONL files. */
export async function buildReport(
  sessionsPath: string,
  since?: string,
  limit?: number,
): Promise<MetricsReport> {
  const sessions = [];
  for (const path of await sessionFiles(sessionsPath)) sessions.push(await analyzeFile(path));
  const selected = sessions
    .filter((session) => !since || (session.timestamp ?? "") >= since)
    .sort((left, right) => (right.timestamp ?? "").localeCompare(left.timestamp ?? ""));
  const report = createReport();
  for (const session of limit === undefined ? selected : selected.slice(0, limit)) addToReport(report, session);
  return report;
}
