import {
  addSkillAvailability,
  analyzeFile,
  addToReport,
  createReport,
  type MetricsReport,
} from "./analyze.ts";
import { sessionFiles } from "./storage.ts";

/** Builds a report directly from Pi session JSONL files. */
export async function buildReport(
  sessionsPath: string,
  since?: string,
  limit?: number,
): Promise<MetricsReport> {
  const files = await sessionFiles(sessionsPath);
  const sessions = await Promise.all(files.map((path) => analyzeFile(path)));
  const selected = sessions
    .filter((session) => !since || (session.timestamp ?? "") >= since)
    .sort((a, b) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
  const report = createReport();
  for (const session of limit === undefined ? selected : selected.slice(0, limit)) addToReport(report, session);
  return addSkillAvailability(report);
}
