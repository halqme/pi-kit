import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_DATABASE = join(homedir(), ".pi", "agent", "session-metrics.duckdb");
const DUCKDB = process.env.DUCKDB_PATH ?? "duckdb";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (event_id VARCHAR PRIMARY KEY, source_path VARCHAR, session_id VARCHAR, cwd VARCHAR, started_at TIMESTAMP);
CREATE TABLE IF NOT EXISTS messages (event_id VARCHAR PRIMARY KEY, source_path VARCHAR, session_id VARCHAR, role VARCHAR, model VARCHAR, created_at TIMESTAMP);
CREATE TABLE IF NOT EXISTS turns (event_id VARCHAR PRIMARY KEY, source_path VARCHAR, session_id VARCHAR, created_at TIMESTAMP);
CREATE TABLE IF NOT EXISTS assistant_usage (event_id VARCHAR PRIMARY KEY, source_path VARCHAR, session_id VARCHAR, model VARCHAR, input_tokens BIGINT, output_tokens BIGINT, cache_read_tokens BIGINT, cache_write_tokens BIGINT, reasoning_tokens BIGINT, total_tokens BIGINT, cost DOUBLE, cache_rebill_cost DOUBLE);
CREATE TABLE IF NOT EXISTS tool_calls (event_id VARCHAR PRIMARY KEY, source_path VARCHAR, session_id VARCHAR, tool_call_id VARCHAR, tool_name VARCHAR, input_bytes BIGINT, created_at TIMESTAMP);
CREATE TABLE IF NOT EXISTS tool_results (event_id VARCHAR PRIMARY KEY, source_path VARCHAR, session_id VARCHAR, tool_call_id VARCHAR, tool_name VARCHAR, is_error BOOLEAN, error_kind VARCHAR, reported_tokens BIGINT, estimated_tokens BIGINT, input_bytes BIGINT, output_bytes BIGINT, duration_ms BIGINT, result_hash VARCHAR, preview VARCHAR, created_at TIMESTAMP);
CREATE TABLE IF NOT EXISTS skill_events (event_id VARCHAR PRIMARY KEY, source_path VARCHAR, session_id VARCHAR, skill_name VARCHAR, event_kind VARCHAR, created_at TIMESTAMP);
CREATE TABLE IF NOT EXISTS indexed_files (path VARCHAR PRIMARY KEY, session_id VARCHAR, mtime_ms BIGINT, size BIGINT, sha256 VARCHAR, indexed_at TIMESTAMP DEFAULT current_timestamp);
`;

export interface IngestResult {
  indexed: number;
  skipped: number;
}

function quote(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function timestamp(value: unknown): string {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? "NULL" : quote(date.toISOString());
}

function timestampMs(value: unknown): number | undefined {
  const time = new Date(String(value ?? "")).getTime();
  return Number.isNaN(time) ? undefined : time;
}

function errorKind(text: string): string | null {
  const normalized = text.toLowerCase();
  if (!text) return null;
  if (normalized.includes("timeout")) return "timeout";
  if (normalized.includes("not found") || normalized.includes("enoent")) return "not_found";
  if (normalized.includes("permission") || normalized.includes("eacces")) return "permission";
  if (normalized.includes("invalid") || normalized.includes("validation")) return "validation";
  return "tool_error";
}

async function run(database: string, sql: string, json = false): Promise<string> {
  try {
    const args = [database, ...(json ? ["-json"] : []), "-c", sql];
    const result = await execFileAsync(DUCKDB, args, { maxBuffer: 20 * 1024 * 1024 });
    return result.stdout.trim();
  } catch (error: any) {
    const detail = error?.stderr?.trim() || error?.message || String(error);
    if (error?.code === "ENOENT")
      throw new Error("DuckDB CLI was not found. Install DuckDB or set DUCKDB_PATH.");
    throw new Error(`DuckDB error: ${detail}`);
  }
}

async function ensureSchema(database: string): Promise<void> {
  await run(
    database,
    `${SCHEMA}
ALTER TABLE assistant_usage ADD COLUMN IF NOT EXISTS reasoning_tokens BIGINT;
ALTER TABLE assistant_usage ADD COLUMN IF NOT EXISTS cache_rebill_cost DOUBLE;
ALTER TABLE tool_calls ADD COLUMN IF NOT EXISTS tool_call_id VARCHAR;
ALTER TABLE tool_calls ADD COLUMN IF NOT EXISTS input_bytes BIGINT;
ALTER TABLE tool_results ADD COLUMN IF NOT EXISTS tool_call_id VARCHAR;
ALTER TABLE tool_results ADD COLUMN IF NOT EXISTS error_kind VARCHAR;
ALTER TABLE tool_results ADD COLUMN IF NOT EXISTS input_bytes BIGINT;
ALTER TABLE tool_results ADD COLUMN IF NOT EXISTS output_bytes BIGINT;
ALTER TABLE tool_results ADD COLUMN IF NOT EXISTS duration_ms BIGINT;
ALTER TABLE tool_results ADD COLUMN IF NOT EXISTS result_hash VARCHAR;
ALTER TABLE tool_results ADD COLUMN IF NOT EXISTS preview VARCHAR;`,
  );
}

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
  }
  return files.sort();
}

function eventRows(path: string, text: string): { sessionId: string | undefined; sql: string[] } {
  const sql: string[] = [];
  let sessionId: string | undefined;
  const toolCalls = new Map<string, { timestamp?: number; inputBytes: number }>();
  let lineNumber = 0;
  for (const line of text.split("\n")) {
    lineNumber++;
    if (!line.trim()) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const eventId = `${path}:${lineNumber}`;
    const type = entry.type;
    if (type === "session") {
      sessionId = String(entry.id ?? eventId);
      sql.push(
        `INSERT INTO sessions VALUES (${quote(eventId)}, ${quote(path)}, ${quote(sessionId)}, ${quote(entry.cwd ?? null)}, ${timestamp(entry.timestamp)});`,
      );
    } else if (type === "turn_end") {
      sql.push(
        `INSERT INTO turns VALUES (${quote(eventId)}, ${quote(path)}, ${quote(sessionId)}, ${timestamp(entry.timestamp)});`,
      );
    } else if (type === "message") {
      const message = entry.message ?? {};
      const role = String(message.role ?? "unknown");
      sql.push(
        `INSERT INTO messages VALUES (${quote(eventId)}, ${quote(path)}, ${quote(sessionId)}, ${quote(role)}, ${quote(message.model ?? null)}, ${timestamp(entry.timestamp ?? message.timestamp)});`,
      );
      if (role === "user") {
        const textContent = (message.content ?? [])
          .filter((block: any) => block?.type === "text")
          .map((block: any) => block.text)
          .join("\n");
        let skillIndex = 0;
        for (const match of textContent.matchAll(/(?:^|\s)\/skill:([a-z0-9-]+)/gi))
          sql.push(
            `INSERT INTO skill_events VALUES (${quote(`${eventId}:skill:${skillIndex++}`)}, ${quote(path)}, ${quote(sessionId)}, ${quote(match[1])}, 'explicit', ${timestamp(entry.timestamp)});`,
          );
      }
      if (role === "assistant") {
        const usage = message.usage ?? {};
        sql.push(
          `INSERT INTO assistant_usage (event_id, source_path, session_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, total_tokens, cost, cache_rebill_cost) VALUES (${quote(eventId)}, ${quote(path)}, ${quote(sessionId)}, ${quote(message.model ?? "unknown")}, ${quote(Number(usage.input ?? 0))}, ${quote(Number(usage.output ?? 0))}, ${quote(Number(usage.cacheRead ?? 0))}, ${quote(Number(usage.cacheWrite ?? 0))}, ${quote(Number(usage.reasoning ?? 0))}, ${quote(Number(usage.totalTokens ?? 0))}, ${quote(Number(usage.cost?.total ?? 0))}, ${quote(Number(usage.cost?.cacheRead ?? 0))});`,
        );
        for (let index = 0; index < (message.content ?? []).length; index++) {
          const block = message.content[index];
          if (block?.type === "toolCall") {
            const toolCallId = String(block.id ?? `${eventId}:tool:${index}`);
            const inputBytes = Buffer.byteLength(JSON.stringify(block.arguments ?? {}), "utf8");
            const callTimestamp = timestampMs(entry.timestamp);
            toolCalls.set(toolCallId, {
              inputBytes,
              ...(callTimestamp !== undefined ? { timestamp: callTimestamp } : {}),
            });
            sql.push(
              `INSERT INTO tool_calls (event_id, source_path, session_id, tool_call_id, tool_name, input_bytes, created_at) VALUES (${quote(`${eventId}:tool:${index}`)}, ${quote(path)}, ${quote(sessionId)}, ${quote(toolCallId)}, ${quote(block.name ?? "unknown")}, ${quote(inputBytes)}, ${timestamp(entry.timestamp)});`,
            );
            const skillPath = String(block.arguments?.path ?? block.arguments?.file ?? "").match(
              /(?:^|[/\\])skills[/\\]([^/\\]+)[/\\]SKILL\\.md$/i,
            );
            if (skillPath?.[1])
              sql.push(
                `INSERT INTO skill_events VALUES (${quote(`${eventId}:skill:${index}`)}, ${quote(path)}, ${quote(sessionId)}, ${quote(skillPath[1])}, 'read', ${timestamp(entry.timestamp)});`,
              );
          }
        }
      }
      if (role === "toolResult") {
        const content = (message.content ?? [])
          .filter((block: any) => block?.type === "text")
          .map((block: any) => block.text)
          .join("\n");
        const toolCallId = String(message.toolCallId ?? "");
        const call = toolCalls.get(toolCallId);
        const resultBytes = Buffer.byteLength(content, "utf8");
        const preview = content.replace(/\s+/g, " ").trim().slice(0, 500);
        const isError = Boolean(message.isError);
        const duration = timestampMs(entry.timestamp);
        const durationMs =
          duration !== undefined && call?.timestamp !== undefined
            ? Math.max(0, duration - call.timestamp)
            : null;
        sql.push(
          `INSERT INTO tool_results (event_id, source_path, session_id, tool_call_id, tool_name, is_error, error_kind, reported_tokens, estimated_tokens, input_bytes, output_bytes, duration_ms, result_hash, preview, created_at) VALUES (${quote(eventId)}, ${quote(path)}, ${quote(sessionId)}, ${quote(toolCallId)}, ${quote(message.toolName ?? "unknown")}, ${quote(isError)}, ${quote(errorKind(isError ? content : ""))}, ${quote(Number(message.usage?.totalTokens ?? 0))}, ${quote(Math.ceil(content.length / 4))}, ${quote(call?.inputBytes ?? null)}, ${quote(resultBytes)}, ${quote(durationMs)}, ${quote(createHash("sha256").update(content).digest("hex"))}, ${quote(preview)}, ${timestamp(entry.timestamp)});`,
        );
      }
    }
  }
  return { sessionId, sql };
}

export async function ingestSessions(
  target: string,
  database = DEFAULT_DATABASE,
): Promise<IngestResult> {
  await ensureSchema(database);
  const files = target.endsWith(".jsonl") ? [target] : await filesUnder(target);
  let indexed = 0;
  let skipped = 0;
  for (const path of files) {
    const info = await stat(path);
    const text = await readFile(path, "utf8");
    const sha256 = createHash("sha256").update(text).digest("hex");
    const existing = await run(
      database,
      `SELECT path, sha256, size, mtime_ms FROM indexed_files WHERE path = ${quote(path)};`,
      true,
    );
    if (existing) {
      try {
        const rows = JSON.parse(existing) as Array<{
          sha256: string;
          size: number;
          mtime_ms: number;
        }>;
        if (
          rows[0]?.sha256 === sha256 &&
          Number(rows[0].size) === info.size &&
          Number(rows[0].mtime_ms) === Math.trunc(info.mtimeMs)
        ) {
          skipped++;
          continue;
        }
      } catch {
        /* Re-index if the CLI returned an unexpected response. */
      }
    }
    const parsed = eventRows(path, text);
    const deleteSql = [
      "BEGIN;",
      ...[
        "sessions",
        "messages",
        "turns",
        "assistant_usage",
        "tool_calls",
        "tool_results",
        "skill_events",
      ].map((table) => `DELETE FROM ${table} WHERE source_path = ${quote(path)};`),
      `DELETE FROM indexed_files WHERE path = ${quote(path)};`,
      ...parsed.sql,
      `INSERT INTO indexed_files (path, session_id, mtime_ms, size, sha256) VALUES (${quote(path)}, ${quote(parsed.sessionId ?? null)}, ${quote(Math.trunc(info.mtimeMs))}, ${quote(info.size)}, ${quote(sha256)});`,
      "COMMIT;",
    ].join("\n");
    await run(database, deleteSql);
    indexed++;
  }
  return { indexed, skipped };
}

export async function showStats(database = DEFAULT_DATABASE): Promise<string> {
  await ensureSchema(database);
  const tables = [
    "sessions",
    "messages",
    "turns",
    "assistant_usage",
    "tool_calls",
    "tool_results",
    "skill_events",
    "indexed_files",
  ];
  const sql =
    tables
      .map((table) => `SELECT ${quote(table)} AS table_name, count(*) AS rows FROM ${table}`)
      .join(" UNION ALL ") + ";";
  return await run(database, sql, true);
}

export async function queryDatabase(sql: string, database = DEFAULT_DATABASE): Promise<string> {
  await ensureSchema(database);
  return run(database, sql, true);
}
