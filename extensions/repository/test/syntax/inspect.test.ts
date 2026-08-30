import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HandleStore } from "../../src/syntax/node-handles.ts";
import { inspect } from "../../src/context/inspect.ts";
import { parseFile, clearFileCache } from "../../src/syntax/parser.ts";

test("TypeScript outline maps a file by declarations without statement-level noise", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-inspect-"));
  const path = join(dir, "sample.ts");
  await writeFile(
    path,
    'import { value } from "./value.js";\nclass Service { run() { return value; } }\nexport function answer(value: number) { if (value > 0) return value; return 0; }\n',
  );
  const handles = new HandleStore();
  const output = await inspect({ path, view: "outline", depth: 5 }, dir, handles);
  assert.match(output, /declaration import/);
  assert.match(output, /declaration export/);
  assert.match(output, /declaration type Service/);
  assert.match(output, /declaration method run/);
  assert.match(output, /declaration function answer/);
  assert.doesNotMatch(output, /control\.|statement\./);
  clearFileCache(path);
});

test("outline summarizes signatures, inheritance, members, and imports", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-inspect-"));
  const path = join(dir, "summary.ts");
  const source = [
    'import { parseSource, PreviousTree as Previous } from "./parser.js";',
    "interface Runnable extends Base { run(input: string): Promise<void>; }",
    "class Service extends Base implements Runnable { run(input: string): Promise<void> {",
    "  const normalized = input.trim();",
    '  const result = normalized.length > 0 ? normalized : "empty";',
    "  console.log(result);",
    "  return Promise.resolve();",
    "} }",
    "export function parseSource(path: string, source: string, previous?: Previous): Promise<ParsedFile> {",
    "  const parsed = source.trim();",
    "  return Promise.resolve({} as ParsedFile);",
    "}",
    "",
  ].join("\n");
  await writeFile(path, source);
  const output = await inspect({ path, view: "outline" }, dir, new HandleStore());
  assert.match(output, /declaration import .*parseSource.*Previous.*\.\/parser\.js/);
  assert.match(output, /declaration type Runnable extends Base.*members: run/);
  assert.match(output, /declaration type Service extends Base implements Runnable.*members: run/);
  assert.match(
    output,
    /declaration function parseSource\(path: string, source: string, previous\?: Previous\): Promise<ParsedFile>/,
  );
  assert.ok(output.length < source.length);
  clearFileCache(path);
});

test("syntax_inspect rematches a stale handle instead of using its old range", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-inspect-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "function answer() { return 1; }\n");
  const handles = new HandleStore();
  const file = await parseFile(path);
  const node = file.tree.rootNode.namedChildren[0];
  assert.ok(node);
  const handle = handles.issue(file, node);
  assert.match(
    await inspect({ path, view: "outline" }, dir, handles),
    /function declaration|declaration function/,
  );
  await writeFile(path, "// こんにちは🌍\nfunction answer() { return 1; }\n");
  assert.equal(
    await inspect({ path, nodeId: handle.id, view: "source" }, dir, handles),
    "function answer() { return 1; }",
  );
  clearFileCache(path);
});

test("syntax_inspect rematches a unique node when its surrounding line changed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-inspect-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "const prefix = 1; function answer() { return 1; }\n");
  const handles = new HandleStore();
  const file = await parseFile(path);
  const node = file.tree.rootNode.namedChildren.find(
    (item) => item?.type === "function_declaration",
  );
  assert.ok(node);
  const handle = handles.issue(file, node);
  await writeFile(path, "const prefix = 2; function answer() { return 1; }\n");
  assert.equal(
    await inspect({ path, nodeId: handle.id, view: "source" }, dir, handles),
    "function answer() { return 1; }",
  );
  clearFileCache(path);
});

test("syntax_inspect supports an explicit language override for an unknown extension", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-inspect-"));
  const path = join(dir, "sample.code");
  await writeFile(path, "function answer() { return 42; }\n");
  const output = await inspect(
    { path, language: "typescript", view: "outline" },
    dir,
    new HandleStore(),
  );
  assert.match(output, /declaration function answer/);
  clearFileCache(path);
});

test("syntax_inspect rejects unsupported files and allows whole-file source reads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-inspect-"));
  await writeFile(join(dir, "sample.rs"), "fn main() {}\n");
  await writeFile(join(dir, "sample.tsx"), "export const App = () => <div />;\n");
  const path = join(dir, "sample.ts");
  const source = "function answer() { return 42; }\n";
  await writeFile(path, source);
  await assert.rejects(
    inspect({ path: "sample.rs", view: "outline" }, dir, new HandleStore()),
    /unsupported_language/,
  );
  await assert.rejects(
    inspect(
      { path: "sample.tsx", language: "typescript", view: "outline" },
      dir,
      new HandleStore(),
    ),
    /unsupported_language/,
  );
  assert.equal(await inspect({ path: "sample.ts", view: "source" }, dir, new HandleStore()), source);
  clearFileCache(path);
});

test("syntax_inspect lets an outlined node advance directly to source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-inspect-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "class Service { answer() { return 42; } }\n");
  const handles = new HandleStore();
  const outline = await inspect({ path, view: "outline" }, dir, handles);
  const outlineId = /node=(n\d+) declaration type Service/.exec(outline)?.[1];
  assert.ok(outlineId);
  await assert.rejects(
    inspect({ path, view: "structure" }, dir, handles),
    /structure_requires_node/,
  );
  assert.equal(
    await inspect({ path, nodeId: outlineId, view: "source" }, dir, handles),
    "class Service { answer() { return 42; } }",
  );
  assert.equal(handles.get(outlineId)?.inspectionStage, "source");
  clearFileCache(path);
});

test("syntax_inspect returns stale_node for an ambiguous rematch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-inspect-"));
  const path = join(dir, "sample.ts");
  const source = "function answer() { return 1; }\n";
  await writeFile(path, source);
  const handles = new HandleStore();
  const file = await parseFile(path);
  const node = file.tree.rootNode.namedChildren[0];
  assert.ok(node);
  const handle = handles.issue(file, node);
  await writeFile(path, `${source}${source}`);
  assert.match(
    await inspect({ path, nodeId: handle.id, view: "source" }, dir, handles),
    /^stale_node:/,
  );
  clearFileCache(path);
});
