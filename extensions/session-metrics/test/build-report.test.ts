import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("returns a missing-source diagnostic while distinguishing an empty directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "session-report-source-"));
  const empty = join(root, "empty");
  const missing = join(root, "missing");
  try {
    await mkdir(empty);

    const missingReport = await buildReport(missing);
    assert.equal(missingReport.sessions, 0);
    assert.equal(missingReport.messages, 0);
    assert.equal(missingReport.tokens.total, 0);
    assert.ok(missingReport.source);
    assert.equal(missingReport.source.path, missing);
    assert.equal(missingReport.source.status, "missing");
    assert.equal(missingReport.source.code, "ENOENT");
    assert.match(missingReport.source.message, /ENOENT/);

    const selected = selectReport(missingReport, { view: "summary", source: missing });
    assert.deepEqual(selected.source, missingReport.source);

    const emptyReport = await buildReport(empty);
    assert.equal(emptyReport.sessions, 0);
    assert.equal(emptyReport.source, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports non-missing source errors instead of hiding them", async () => {
  const report = await buildReport("\u0000");
  assert.equal(report.sessions, 0);
  assert.ok(report.source);
  assert.equal(report.source.path, "\u0000");
  assert.equal(report.source.status, "error");
  assert.equal(report.source.code, "ERR_INVALID_ARG_VALUE");
});

test("rejects an invalid since date before missing-source recovery", async () => {
  await assert.rejects(
    () => buildReport("/definitely/missing/session-metrics", "not-a-date"),
    /Invalid since date/,
  );
});
