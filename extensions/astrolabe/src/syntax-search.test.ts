import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HandleStore } from "./node-handles.ts";
import { syntaxSearch } from "./syntax-search.ts";

test("syntax_search finds functions, calls, and imports by syntax", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-search-"));
  const path = join(dir, "sample.ts");
  await writeFile(
    path,
    'import { parseSource } from "web-tree-sitter";\nfunction parseSource(source: string) { return source; }\nparseSource("input");\n',
  );
  const handles = new HandleStore();
  const functionResult = await syntaxSearch(
    { path, kind: "function", name: "parseSource" },
    dir,
    handles,
  );
  assert.match(functionResult, /nodeId=n\d+ parseSource \(function_declaration, 2:1-/);
  const callResult = await syntaxSearch({ path, kind: "call", name: "parseSource" }, dir, handles);
  assert.match(callResult, /nodeId=n\d+ parseSource \(call_expression, 3:1-/);
  const importResult = await syntaxSearch(
    { path, kind: "import", source: "web-tree-sitter" },
    dir,
    handles,
  );
  assert.match(importResult, /nodeId=n\d+ web-tree-sitter \(import_statement, 1:1-/);
});

test("syntax_search searches supported files recursively within a directory scope", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-search-"));
  const nested = join(dir, "nested");
  const outside = await mkdtemp(join(tmpdir(), "astrolabe-search-outside-"));
  await mkdir(nested);
  await writeFile(join(dir, "top.ts"), "exists();\n");
  await writeFile(join(nested, "inner.py"), "exists()\n");
  await writeFile(join(nested, "ignored.md"), "exists()\n");
  await writeFile(join(outside, "outside.ts"), "exists();\n");
  await symlink(join(outside, "outside.ts"), join(nested, "outside.ts"));
  const handles = new HandleStore();

  const result = await syntaxSearch({ scope: dir, kind: "call", name: "exists" }, dir, handles);
  assert.match(result, /nodeId=n\d+ exists \(call_expression, 1:1-/);
  assert.equal(result.split("\n").length, 2);
  assert.ok(handles.list(join(dir, "top.ts")).length > 0);
  assert.ok(handles.list(join(nested, "inner.py")).length > 0);
});

test("syntax_search returns no matches and applies exact filters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-search-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "function first() {}\nfunction second() {}\nfirst();\n");
  const handles = new HandleStore();
  assert.equal(
    await syntaxSearch({ path, kind: "function", name: "missing" }, dir, handles),
    "(no syntax matches)",
  );
  const result = await syntaxSearch({ path, kind: "function", name: "second" }, dir, handles);
  assert.match(result, /second/);
  assert.doesNotMatch(result, /first/);
});
