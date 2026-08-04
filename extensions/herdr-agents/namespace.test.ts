import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createAgentNamespace, validateLogicalName } from "./namespace.ts";

const execFileAsync = promisify(execFile);

test("uses one namespace across subdirectories of the same repository", async () => {
  const root = await mkdtemp(join(tmpdir(), "herdr-namespace-"));
  try {
    await execFileAsync("git", ["init", root]);
    const nested = join(root, "packages", "app");
    await mkdir(nested, { recursive: true });

    const fromRoot = await createAgentNamespace(root);
    const fromNested = await createAgentNamespace(nested);

    assert.equal(fromRoot.id, fromNested.id);
    assert.equal(fromRoot.qualify("backend"), fromNested.qualify("backend"));
    assert.equal(fromRoot.logicalName(fromRoot.qualify("backend")), "backend");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("different directories receive different namespaces", async () => {
  const first = await mkdtemp(join(tmpdir(), "herdr-namespace-a-"));
  const second = await mkdtemp(join(tmpdir(), "herdr-namespace-b-"));
  try {
    const a = await createAgentNamespace(first);
    const b = await createAgentNamespace(second);
    assert.notEqual(a.id, b.id);
    assert.equal(a.owns(b.qualify("worker")), false);
  } finally {
    await Promise.all([
      rm(first, { recursive: true, force: true }),
      rm(second, { recursive: true, force: true }),
    ]);
  }
});

test("logical names leave room for the repository prefix", () => {
  assert.doesNotThrow(() => validateLogicalName("reviewer-1"));
  assert.doesNotThrow(() => validateLogicalName("a".repeat(25)));
  assert.throws(() => validateLogicalName("a".repeat(26)));
  assert.throws(() => validateLogicalName("Reviewer"));
});
