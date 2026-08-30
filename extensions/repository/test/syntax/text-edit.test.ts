import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { editTextDetailed } from "../../src/code/text-edit.ts";
import { HandleStore } from "../../src/syntax/node-handles.ts";
import { clearFileCache } from "../../src/syntax/parser.ts";

test("resolves one exact text match into the structural edit path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "text-edit-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "export const answer = 1;\n", "utf8");
  const handles = new HandleStore();

  const result = await editTextDetailed(
    { path: "sample.ts", oldText: "answer = 1", newText: "answer = 2" },
    dir,
    handles,
  );

  assert.match(result.message, /^edited /);
  assert.equal(result.targetType, "variable_declarator");
  assert.equal(await readFile(path, "utf8"), "export const answer = 2;\n");
  clearFileCache(path);
});

test("rejects ambiguous text without changing the file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "text-edit-"));
  const path = join(dir, "sample.ts");
  const source = "const answer = 1;\nconst other = answer + answer;\n";
  await writeFile(path, source, "utf8");
  const handles = new HandleStore();

  const result = await editTextDetailed(
    { path: "sample.ts", oldText: "answer", newText: "value" },
    dir,
    handles,
  );

  assert.equal(
    result.message,
    "old_text_not_unique: oldText occurs more than once; provide a larger exact match.",
  );
  assert.equal(await readFile(path, "utf8"), source);
  clearFileCache(path);
});

test("rejects a structural syntax break without changing the file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "text-edit-"));
  const path = join(dir, "sample.ts");
  const source = "export const answer = 1;\n";
  await writeFile(path, source, "utf8");
  const handles = new HandleStore();

  const result = await editTextDetailed(
    { path: "sample.ts", oldText: "answer = 1", newText: "answer = (" },
    dir,
    handles,
  );

  assert.match(result.message, /^syntax_error:/);
  assert.equal(await readFile(path, "utf8"), source);
  clearFileCache(path);
});
