import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sessionFiles } from "../src/files.ts";

test("finds JSONL files deterministically without following symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "session-metrics-"));
  try {
    await mkdir(join(root, "nested"));
    const first = join(root, "a.jsonl");
    const second = join(root, "nested", "b.jsonl");
    await writeFile(first, "{}\n");
    await writeFile(second, "{}\n");
    await writeFile(join(root, "ignore.txt"), "{}\n");
    await symlink(join(root, "nested"), join(root, "linked"));

    assert.deepEqual(await sessionFiles(root), [await realpath(first), await realpath(second)]);
    assert.deepEqual(await sessionFiles(first), [await realpath(first)]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
