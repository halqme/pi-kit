import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathIsWithin, resolveExistingPath } from "./path.ts";

test("resolves existing files using real paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-path-"));
  const file = join(dir, "sample.ts");
  await writeFile(file, "const answer = 42;\n");
  assert.equal(await resolveExistingPath(dir, "sample.ts"), file);
  await assert.rejects(resolveExistingPath(dir, "missing.ts"), /existing file/);
  await assert.rejects(
    resolveExistingPath(dir, "../outside.ts"),
    /existing file|working directory/,
  );
});

test("rejects a symlink that resolves outside the working directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-path-"));
  const outside = await mkdtemp(join(tmpdir(), "astrolabe-outside-"));
  const outsideFile = join(outside, "outside.ts");
  await writeFile(outsideFile, "const secret = true;\n");
  await symlink(outsideFile, join(dir, "link.ts"));
  await assert.rejects(resolveExistingPath(dir, "link.ts"), /working directory/);
});

test("checks lexical containment without treating a similarly named directory as a child", () => {
  assert.equal(pathIsWithin("/tmp/project", "/tmp/project/src/file.ts"), true);
  assert.equal(pathIsWithin("/tmp/project", "/tmp/project-copy/file.ts"), false);
  assert.equal(pathIsWithin("/tmp/project", "/tmp/project/../secret.ts"), false);
});
