import {
  addToReport,
  analyzeFile,
  createReport,
  type MetricsReport,
  type SessionMetrics,
} from "./analyze.ts";
import {
  analyzeSessionDiagnostics,
  createSessionDiagnosticsSummary,
  mergeSessionDiagnostics,
} from "./diagnostics.ts";
import { sessionFiles } from "./files.ts";
import type { SessionDiagnostics } from "./types.ts";

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
  const sessions: Array<{ metrics: SessionMetrics; diagnostics: SessionDiagnostics }> = [];
  try {
    for (const path of await sessionFiles(sessionsPath)) {
      const [metrics, diagnostics] = await Promise.all([
        analyzeFile(path),
        analyzeSessionDiagnostics(path),
      ]);
      sessions.push({ metrics, diagnostics });
    }
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : "UNKNOWN";
    const report = createReport();
    report.source = {
      path: sessionsPath,
      status: code === "ENOENT" ? "missing" : "error",
      code,
      message: error instanceof Error ? error.message : String(error),
    };
    return report;
  }
  const selected = sessions
    .filter(({ metrics }) => !since || (metrics.timestamp ?? "") >= since)
    .sort((left, right) =>
      (right.metrics.timestamp ?? "").localeCompare(left.metrics.timestamp ?? ""),
    );
  const report = createReport();
  report.diagnostics = createSessionDiagnosticsSummary();
  for (const session of selected) {
    addToReport(report, session.metrics);
    mergeSessionDiagnostics(report.diagnostics, session.diagnostics);
  }
  return report;
}
