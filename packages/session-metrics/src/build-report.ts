import {
  addToReport,
  analyzeFile,
  createReport,
  type MetricsReport,
  type SessionMetrics,
} from "./analyze.ts";
import { sessionFiles } from "./files.ts";

function validateSince(since?: string): void {
  if (
    since &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(since) || Number.isNaN(Date.parse(`${since}T00:00:00Z`)))
  ) {
    throw new Error(`Invalid since date: ${since}`);
  }
}

/** Builds a deterministic report directly from Pi session JSONL files. */
export async function buildReport(sessionsPath: string, since?: string): Promise<MetricsReport> {
  validateSince(since);
  const sessions: SessionMetrics[] = [];
  for (const path of await sessionFiles(sessionsPath)) sessions.push(await analyzeFile(path));
  const selected = sessions
    .filter((session) => !since || (session.timestamp ?? "") >= since)
    .sort((left, right) => (right.timestamp ?? "").localeCompare(left.timestamp ?? ""));
  const report = createReport();
  for (const session of selected) addToReport(report, session);
  return report;
}
