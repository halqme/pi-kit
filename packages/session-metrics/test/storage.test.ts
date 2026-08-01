import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ingestSessions, queryDatabase, showStats } from "../src/storage.ts";

const execFileAsync = promisify(execFile);
let hasDuckdb = true;
try {
  await execFileAsync(process.env.DUCKDB_PATH ?? "duckdb", ["--version"]);
} catch {
  hasDuckdb = false;
}

test(
  "incrementally indexes files and replaces changed files",
  { skip: !hasDuckdb && "DuckDB CLI is not installed" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "session-metrics-"));
    const database = join(root, "metrics.duckdb");
    const file = join(root, "session.jsonl");
    try {
      await execFileAsync(process.env.DUCKDB_PATH ?? "duckdb", [
        database,
        "-c",
        "CREATE TABLE assistant_usage (event_id VARCHAR PRIMARY KEY, source_path VARCHAR, session_id VARCHAR, model VARCHAR, input_tokens BIGINT, output_tokens BIGINT, cache_read_tokens BIGINT, cache_write_tokens BIGINT, total_tokens BIGINT, cost DOUBLE);",
      ]);
      await writeFile(
        file,
        `${JSON.stringify({ type: "session", id: "s1", timestamp: "2026-04-01T00:00:00Z" })}\n${JSON.stringify({ type: "message", timestamp: "2026-04-01T00:00:01Z", message: { role: "assistant", model: "model/a", content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } }], usage: { input: 10, output: 4, cacheRead: 6, cacheWrite: 2, reasoning: 3, totalTokens: 22, cost: { total: 0.5, cacheRead: 0.1 } } } })}\n${JSON.stringify({ type: "message", timestamp: "2026-04-01T00:00:02Z", message: { role: "toolResult", toolCallId: "call-1", toolName: "read", isError: true, content: [{ type: "text", text: "permission denied" }], usage: { totalTokens: 4 } } })}\n`,
      );
      assert.deepEqual(await ingestSessions(root, database), { indexed: 1, skipped: 0 });
      assert.deepEqual(await ingestSessions(root, database), { indexed: 0, skipped: 1 });
      const usage = JSON.parse(
        await queryDatabase(
          "select input_tokens, cache_read_tokens, reasoning_tokens, cache_rebill_cost from assistant_usage",
          database,
        ),
      )[0];
      assert.deepEqual(usage, {
        input_tokens: 10,
        cache_read_tokens: 6,
        reasoning_tokens: 3,
        cache_rebill_cost: 0.1,
      });
      const toolResult = JSON.parse(
        await queryDatabase(
          "select tool_call_id, error_kind, input_bytes, output_bytes, duration_ms, preview from tool_results",
          database,
        ),
      )[0];
      assert.equal(toolResult.tool_call_id, "call-1");
      assert.equal(toolResult.error_kind, "permission");
      assert.equal(toolResult.duration_ms, 1000);
      assert.equal(toolResult.preview, "permission denied");
      await writeFile(
        file,
        `${JSON.stringify({ type: "session", id: "s1", timestamp: "2026-04-01T00:00:00Z" })}\n${JSON.stringify({ type: "turn_end" })}\n`,
      );
      assert.deepEqual(await ingestSessions(root, database), { indexed: 1, skipped: 0 });
      const stats = JSON.parse(await showStats(database)) as Array<{
        table_name: string;
        rows: number;
      }>;
      assert.equal(stats.find((row) => row.table_name === "turns")?.rows, 1);
      assert.equal(
        JSON.parse(await queryDatabase("select count(*) as count from indexed_files", database))[0]
          .count,
        1,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
