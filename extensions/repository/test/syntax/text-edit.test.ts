import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { editTextDetailed } from "../../src/code/text-edit.ts";
import { clearFileCache } from "../../src/syntax/parser.ts";

test("applies one exact text edit with syntax validation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "text-edit-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "export const answer = 1;\n", "utf8");

  const result = await editTextDetailed(
    { path: "sample.ts", oldText: "answer = 1", newText: "answer = 2" },
    dir,
  );

  assert.equal(result.ok, true);
  assert.equal(await readFile(path, "utf8"), "export const answer = 2;\n");
  clearFileCache(path);
});

test("rejects ambiguous text without changing the file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "text-edit-"));
  const path = join(dir, "sample.ts");
  const source = "const answer = 1;\nconst other = answer + answer;\n";
  await writeFile(path, source, "utf8");

  const result = await editTextDetailed(
    { path: "sample.ts", oldText: "answer", newText: "value" },
    dir,
  );

  assert.deepEqual(result, {
    ok: false,
    code: "old_text_not_unique",
    message: "oldText occurs more than once; provide a larger exact match.",
  });
  assert.equal(await readFile(path, "utf8"), source);
  clearFileCache(path);
});

test("rejects a new syntax issue without changing the file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "text-edit-"));
  const path = join(dir, "sample.ts");
  const source = "export const answer = 1;\n";
  await writeFile(path, source, "utf8");

  const result = await editTextDetailed(
    { path: "sample.ts", oldText: "answer = 1", newText: "answer = (" },
    dir,
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "syntax_error");
  assert.equal(await readFile(path, "utf8"), source);
  clearFileCache(path);
});
