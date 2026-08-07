import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ingestSessions, sessionFiles } from "../src/storage.ts";

test("finds JSONL files and reports changed files without external storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "session-metrics-"));
  try {
    const file = join(root, "session.jsonl");
    await writeFile(file, '{"type":"session","id":"s1"}\nnot json\n');
    assert.deepEqual(await sessionFiles(root), [await realpath(file)]);
    assert.deepEqual(await ingestSessions(root), { indexed: 1, skipped: 0 });
    assert.deepEqual(await ingestSessions(root), { indexed: 0, skipped: 1 });
    await writeFile(file, '{"type":"session","id":"s1"}\n{"type":"turn_end"}\n');
    assert.deepEqual(await ingestSessions(root), { indexed: 1, skipped: 0 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
