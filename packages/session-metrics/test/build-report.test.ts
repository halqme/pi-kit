import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildReport } from "../src/build-report.ts";
import { selectReport } from "../src/selection.ts";

test("builds all sessions while selection limits only rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "session-report-"));
  try {
    await writeFile(
      join(root, "a.jsonl"),
      `${JSON.stringify({ type: "session", id: "a", cwd: "/a", timestamp: "2026-01-01T00:00:00Z" })}\n`,
    );
    await writeFile(
      join(root, "b.jsonl"),
      `${JSON.stringify({ type: "session", id: "b", cwd: "/b", timestamp: "2026-01-02T00:00:00Z" })}\n`,
    );

    const report = await buildReport(root);
    assert.equal(report.sessions, 2);
    const output = selectReport(report, { view: "projects", limit: 1 });
    assert.equal((output.data as { rows: unknown[] }).rows.length, 1);
    assert.equal(report.sessions, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
