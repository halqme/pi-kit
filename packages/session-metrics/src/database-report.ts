import {
  addToReport,
  createMetrics,
  createReport,
  type MetricsReport,
  type SessionMetrics,
} from "./analyze.ts";
import { queryDatabase } from "./storage.ts";

interface Row {
  source_path: string;
  session_id: string;
  cwd?: string;
  started_at?: string;
  event_id?: string;
  role?: string;
  model?: string;
  created_at?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  reasoning_tokens?: number;
  total_tokens?: number;
  cost?: number;
  cache_rebill_cost?: number;
  tool_name?: string;
  is_error?: boolean;
  skill_name?: string;
  event_kind?: string;
  reported_tokens?: number;
  estimated_tokens?: number;
}

function rows(sql: string, database?: string): Promise<Row[]> {
  return queryDatabase(sql, database).then((text) => JSON.parse(text) as Row[]);
}

function addUsage(target: SessionMetrics, row: Row): void {
  const values = {
    input: Number(row.input_tokens ?? 0),
    output: Number(row.output_tokens ?? 0),
    cacheRead: Number(row.cache_read_tokens ?? 0),
    cacheWrite: Number(row.cache_write_tokens ?? 0),
    reasoning: Number(row.reasoning_tokens ?? 0),
    total: Number(row.total_tokens ?? 0),
    cost: Number(row.cost ?? 0),
    cacheCost: Number(row.cache_rebill_cost ?? 0),
  };
  for (const key of Object.keys(values) as Array<keyof typeof values>)
    target.tokens[key] += values[key];
  const model = row.model ?? "unknown";
  const entry = (target.models[model] ??= {
    messages: 0,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 0,
      cost: 0,
      cacheCost: 0,
    },
  });
  entry.messages++;
  for (const key of Object.keys(values) as Array<keyof typeof values>)
    entry.usage[key] += values[key];
}

export async function buildDatabaseReport(
  database?: string,
  since?: string,
  limit?: number,
): Promise<MetricsReport> {
  const filter = since ? ` AND CAST(created_at AS DATE) >= '${since}'` : "";
  const [sessions, messages, turns, usage, calls, results, skills] = await Promise.all([
    rows("SELECT source_path, session_id, cwd, started_at FROM sessions", database),
    rows(
      `SELECT source_path, session_id, role, model, created_at FROM messages WHERE 1 = 1${filter}`,
      database,
    ),
    rows(`SELECT source_path, session_id, created_at FROM turns WHERE 1 = 1${filter}`, database),
    rows(
      `SELECT source_path, session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, total_tokens, cost, cache_rebill_cost FROM assistant_usage WHERE 1 = 1${filter}`,
      database,
    ),
    rows(
      `SELECT source_path, session_id, tool_name, created_at FROM tool_calls WHERE 1 = 1${filter}`,
      database,
    ),
    rows(
      `SELECT source_path, session_id, tool_name, is_error, reported_tokens, estimated_tokens, created_at FROM tool_results WHERE 1 = 1${filter}`,
      database,
    ),
    rows(
      `SELECT source_path, session_id, skill_name, event_kind, created_at FROM skill_events WHERE 1 = 1${filter}`,
      database,
    ),
  ]);
  const bySession = new Map<string, SessionMetrics>();
  for (const row of sessions) {
    const metric = createMetrics() as SessionMetrics;
    metric.sessions = 1;
    metric.sessionId = row.session_id;
    if (row.cwd !== undefined) metric.cwd = row.cwd;
    if (row.started_at !== undefined) metric.timestamp = row.started_at;
    bySession.set(row.session_id, metric);
  }
  const get = (row: Row) => {
    const existing = bySession.get(row.session_id);
    if (existing) return existing;
    const metric = createMetrics() as SessionMetrics;
    metric.sessions = 1;
    metric.sessionId = row.session_id;
    bySession.set(row.session_id, metric);
    return metric;
  };
  for (const row of messages) {
    const metric = get(row);
    metric.messages++;
    if (row.role === "user") metric.userMessages++;
    if (row.role === "assistant") metric.assistantMessages++;
  }
  for (const row of turns) get(row).turns++;
  for (const row of usage) {
    const metric = get(row);
    addUsage(metric, row);
    if (turns.length === 0) metric.turns++;
  }
  for (const row of calls) {
    const metric = get(row);
    metric.toolCalls++;
    metric.toolCallsByName[row.tool_name ?? "unknown"] =
      (metric.toolCallsByName[row.tool_name ?? "unknown"] ?? 0) + 1;
    const tool = (metric.toolUsage[row.tool_name ?? "unknown"] ??= {
      available: true,
      calls: 0,
      estimatedResultTokens: 0,
      reportedTokens: 0,
      errors: 0,
    });
    tool.calls++;
  }
  for (const row of usage) {
    const metric = get(row);
    const model = row.model ?? "unknown";
    const effort = (metric.thinkingLevels.unknown ??= {
      messages: 0,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        total: 0,
        cost: 0,
        cacheCost: 0,
      },
    });
    effort.messages++;
    const modelEffort = (metric.modelEfforts[`${model}\0unknown`] ??= {
      model,
      effort: "unknown",
      messages: 0,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        total: 0,
        cost: 0,
        cacheCost: 0,
      },
    });
    modelEffort.messages++;
    for (const key of [
      "input",
      "output",
      "cacheRead",
      "cacheWrite",
      "reasoning",
      "total",
      "cost",
      "cacheCost",
    ] as const) {
      effort.usage[key] +=
        metric.tokens[key] -
        (metric.tokens[key] -
          Number(
            row[
              (
                {
                  input: "input_tokens",
                  output: "output_tokens",
                  cacheRead: "cache_read_tokens",
                  cacheWrite: "cache_write_tokens",
                  reasoning: "reasoning_tokens",
                  total: "total_tokens",
                  cost: "cost",
                  cacheCost: "cache_rebill_cost",
                } as const
              )[key]
            ] ?? 0,
          ));
      modelEffort.usage[key] = effort.usage[key];
    }
  }
  for (const row of results) {
    const metric = get(row);
    metric.toolResults++;
    if (row.is_error) metric.errors++;
    const tool = (metric.toolUsage[row.tool_name ?? "unknown"] ??= {
      available: true,
      calls: 0,
      estimatedResultTokens: 0,
      reportedTokens: 0,
      errors: 0,
    });
    tool.estimatedResultTokens += Number(row.estimated_tokens ?? 0);
    tool.reportedTokens += Number(row.reported_tokens ?? 0);
    if (row.is_error) tool.errors++;
  }
  for (const row of skills) {
    const metric = get(row);
    const name = row.skill_name ?? "unknown";
    if (!/^[a-z0-9-]+$/i.test(name)) continue;
    const skill = (metric.skills[name] ??= {
      reads: 0,
      explicit: 0,
      existsGlobally: true,
      existsInProject: true,
    });
    if (row.event_kind === "read") skill.reads++;
    else skill.explicit++;
  }
  const report = createReport();
  const selected = [...bySession.values()].sort((a, b) =>
    (b.timestamp ?? "").localeCompare(a.timestamp ?? ""),
  );
  for (const metric of limit === undefined ? selected : selected.slice(0, limit))
    addToReport(report, metric);
  return report;
}
