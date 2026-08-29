import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pathIsWithin,
  resolveExistingPath,
  resolveExistingScope,
  sourceFilesInScope,
} from "../../src/syntax/path.ts";

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

test("resolves file and directory scopes and walks only regular supported files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-path-"));
  const nested = join(dir, "nested");
  const outside = await mkdtemp(join(tmpdir(), "astrolabe-outside-"));
  await writeFile(join(dir, "top.ts"), "export const top = true;\n");
  await writeFile(join(dir, "notes.md"), "ignored\n");
  await writeFile(join(outside, "outside.ts"), "export const outside = true;\n");
  await mkdir(nested);
  await writeFile(join(nested, "inner.py"), "answer = 42\n");
  await symlink(join(outside, "outside.ts"), join(nested, "outside.ts"));

  assert.deepEqual(await resolveExistingScope(dir, "nested"), { path: nested, kind: "directory" });
  assert.deepEqual(
    (await sourceFilesInScope(dir, ".", (path) => /\.(?:ts|py)$/.test(path))).map((path) =>
      path.slice(dir.length + 1),
    ),
    ["nested/inner.py", "top.ts"],
  );
});

test("checks lexical containment without treating a similarly named directory as a child", () => {
  assert.equal(pathIsWithin("/tmp/project", "/tmp/project/src/file.ts"), true);
  assert.equal(pathIsWithin("/tmp/project", "/tmp/project-copy/file.ts"), false);
  assert.equal(pathIsWithin("/tmp/project", "/tmp/project/../secret.ts"), false);
});
