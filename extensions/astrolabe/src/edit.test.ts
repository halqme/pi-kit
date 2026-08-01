import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearFileCache, parseFile } from "./parser.ts";
import { HandleStore } from "./node-handles.ts";
import { edit, editContinuationDetailed } from "./edit.ts";

test("replaces an inspected node and rejects stale content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tree-edit-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "function answer() { return 1; }\n");
  const file = await parseFile(path);
  const node = file.tree.rootNode.namedChildren.find(
    (item) => item?.type === "function_declaration",
  );
  assert.ok(node);
  const body = node.namedChildren.find((item) => item?.type === "statement_block");
  assert.ok(body);
  const returned = body.namedChildren.find((item) => item?.type === "return_statement");
  assert.ok(returned);
  const handles = new HandleStore();
  const handle = handles.issue(file, returned);
  assert.match(
    await edit({ path, nodeId: handle.id, replacement: "return 2;" }, dir, handles),
    /edited .*return_statement with typescript; re-inspect before further edits/,
  );
  assert.match(await readFile(path, "utf8"), /return 2/);
  assert.equal((await parseFile(path)).parseMode, "incremental");
  await writeFile(path, "function answer() { return 3; }\n");
  assert.match(
    await edit({ path, nodeId: handle.id, replacement: "return 4;" }, dir, handles),
    /stale_node/,
  );
  clearFileCache(path);
});

test("revalidates a continuation before writing without requiring source retrieval", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tree-edit-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "function answer() { return 1; }\n");
  const file = await parseFile(path);
  const node = file.tree.rootNode.namedChildren[0];
  assert.ok(node);
  const handles = new HandleStore();
  const handle = handles.issue(file, node, "outline");
  const token = handles.issueContinuation(handle.id);
  assert.ok(token);
  assert.match(
    (
      await editContinuationDetailed(
        { continuation: { token }, replacement: "function answer() { return 2; }" },
        dir,
        handles,
      )
    ).message,
    /edited/,
  );
  clearFileCache(path);
});

test("edits Unicode source with CRLF incrementally and preserves file mode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tree-edit-"));
  const path = join(dir, "sample.ts");
  const original = '// こんにちは🌍\r\nfunction answer() {\r\n  return "こんにちは🌍";\r\n}\r\n';
  await writeFile(path, original);
  await chmod(path, 0o755);
  const file = await parseFile(path);
  const functionNode = file.tree.rootNode.namedChildren.find(
    (item) => item?.type === "function_declaration",
  );
  assert.ok(functionNode);
  const returned = functionNode.namedChildren
    .find((item) => item?.type === "statement_block")
    ?.namedChildren.find((item) => item?.type === "return_statement");
  assert.ok(returned);
  const handles = new HandleStore();
  const handle = handles.issue(file, returned, "source");
  assert.match(
    await edit(
      { path, nodeId: handle.id, replacement: 'return "こんにちは🌍";\r\n  return "ok";' },
      dir,
      handles,
    ),
    /edited/,
  );
  assert.equal(
    await readFile(path, "utf8"),
    '// こんにちは🌍\r\nfunction answer() {\r\n  return "こんにちは🌍";\r\n  return "ok";\r\n}\r\n',
  );
  assert.equal((await parseFile(path)).parseMode, "incremental");
  assert.equal((await stat(path)).mode & 0o777, 0o755);
  clearFileCache(path);
});

test("edits a node after mixed Unicode and preserves later positions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tree-edit-unicode-"));
  const path = join(dir, "sample.ts");
  const original =
    'const 日本語 = "こんにちは";\nconst globe = "🌍";\nfunction answer() {\n  return "旧";\n}\n';
  await writeFile(path, original);
  const file = await parseFile(path);
  const functionNode = file.tree.rootNode.namedChildren.find(
    (item) => item?.type === "function_declaration",
  );
  assert.ok(functionNode);
  const returned = functionNode.namedChildren
    .find((item) => item?.type === "statement_block")
    ?.namedChildren.find((item) => item?.type === "return_statement");
  assert.ok(returned);
  const handles = new HandleStore();
  const handle = handles.issue(file, returned, "source");
  assert.match(
    await edit({ path, nodeId: handle.id, replacement: 'return "新しい🚀";' }, dir, handles),
    /edited/,
  );
  assert.match(await readFile(path, "utf8"), /return "新しい🚀"/);
  assert.equal((await parseFile(path)).syntaxErrors, 0);
  clearFileCache(path);
});

test("rejects a new syntax issue and leaves the file and cache unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tree-edit-"));
  const path = join(dir, "sample.ts");
  const original = "function answer() { return 1; }\n";
  await writeFile(path, original);
  const file = await parseFile(path);
  const returned = file.tree.rootNode.namedChildren[0]?.namedChildren
    .find((item) => item?.type === "statement_block")
    ?.namedChildren.find((item) => item?.type === "return_statement");
  assert.ok(returned);
  const handles = new HandleStore();
  const handle = handles.issue(file, returned, "source");
  assert.match(
    await edit({ path, nodeId: handle.id, replacement: "return (" }, dir, handles),
    /^syntax_error:/,
  );
  assert.equal(await readFile(path, "utf8"), original);
  assert.equal(await parseFile(path), file);
  clearFileCache(path);
});

test("rejects a replacement whose syntax node type changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tree-edit-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "function answer() { return 1; }\n");
  const file = await parseFile(path);
  const functionNode = file.tree.rootNode.namedChildren[0];
  assert.ok(functionNode);
  const handles = new HandleStore();
  const handle = handles.issue(file, functionNode, "source");
  assert.match(
    await edit({ path, nodeId: handle.id, replacement: "const answer = 1;" }, dir, handles),
    /changes node type/,
  );
  assert.match(await readFile(path, "utf8"), /function answer/);
  clearFileCache(path);
});

test("does not update the cache and cleans up when temporary writing fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tree-edit-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "function answer() { return 1; }\n");
  const file = await parseFile(path);
  const returned = file.tree.rootNode.namedChildren[0]?.namedChildren
    .find((item) => item?.type === "statement_block")
    ?.namedChildren.find((item) => item?.type === "return_statement");
  assert.ok(returned);
  const handles = new HandleStore();
  const handle = handles.issue(file, returned, "source");
  await chmod(dir, 0o555);
  try {
    await assert.rejects(edit({ path, nodeId: handle.id, replacement: "return 2;" }, dir, handles));
  } finally {
    await chmod(dir, 0o755);
  }
  assert.deepEqual(
    (await readdir(dir)).filter((name) => name.endsWith(".tmp")),
    [],
  );
  assert.equal(await parseFile(path), file);
  clearFileCache(path);
});
