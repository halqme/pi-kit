import test from "node:test";
import assert from "node:assert/strict";
import { typescriptAdapter } from "../languages/typescript/config.ts";
import type { LanguageAdapter } from "./language-profile.ts";
import { HandleStore, resolveHandle } from "./node-handles.ts";
import { parseSource } from "./parser.ts";

test("bounds handles per file and retains recently used handles", async () => {
  const file = await parseSource(
    "/tmp/handles.ts",
    "function first() { return 1; }\nfunction second() { return 2; }\n",
  );
  const first = file.tree.rootNode.namedChildren[0];
  const second = file.tree.rootNode.namedChildren[1];
  assert.ok(first);
  assert.ok(second);
  const handles = new HandleStore(2);
  const h1 = handles.issue(file, first);
  const h2 = handles.issue(file, second);
  assert.equal(handles.size(file.path), 2);
  assert.equal(handles.get(h1.id)?.id, h1.id);
  const h3 = handles.issue(file, first);
  assert.equal(handles.size(file.path), 2);
  assert.equal(handles.get(h2.id), undefined);
  assert.equal(handles.get(h1.id)?.id, h1.id);
  assert.equal(handles.get(h3.id)?.id, h3.id);
});

test("continuations are opaque and expire on explicit deletion", async () => {
  const file = await parseSource("/tmp/continuation.ts", "function answer() {}\n");
  const node = file.tree.rootNode.namedChildren[0];
  assert.ok(node);
  const handles = new HandleStore();
  const handle = handles.issue(file, node);
  const token = handles.issueContinuation(handle.id);
  assert.ok(token);
  assert.equal(handles.resolveContinuation(token)?.id, handle.id);
  handles.delete(handle.id);
  assert.equal(handles.resolveContinuation(token), undefined);
  file.tree.delete();
});

test("continuations survive LRU eviction and reactivate their handles", async () => {
  const file = await parseSource(
    "/tmp/continuation-lru.ts",
    "function first() {}\nfunction second() {}\n",
  );
  const first = file.tree.rootNode.namedChildren[0];
  const second = file.tree.rootNode.namedChildren[1];
  assert.ok(first);
  assert.ok(second);
  const handles = new HandleStore(1);
  const firstHandle = handles.issue(file, first);
  const token = handles.issueContinuation(firstHandle.id);
  assert.ok(token);
  const secondHandle = handles.issue(file, second);
  assert.equal(handles.get(firstHandle.id), undefined);
  assert.equal(handles.resolveContinuation(token)?.id, firstHandle.id);
  assert.equal(handles.size(file.path), 1);
  assert.equal(handles.get(secondHandle.id), undefined);
});

test("clearing a path invalidates continuations even after their handles were evicted", async () => {
  const file = await parseSource(
    "/tmp/continuation-clear.ts",
    "function first() {}\nfunction second() {}\n",
  );
  const first = file.tree.rootNode.namedChildren[0];
  const second = file.tree.rootNode.namedChildren[1];
  assert.ok(first);
  assert.ok(second);
  const handles = new HandleStore(1);
  const firstHandle = handles.issue(file, first);
  const token = handles.issueContinuation(firstHandle.id);
  assert.ok(token);
  handles.issue(file, second);
  handles.clear(file.path);
  assert.equal(handles.resolveContinuation(token), undefined);
});

test("LRU eviction follows access order rather than issue order", async () => {
  const file = await parseSource(
    "/tmp/handles-lru.ts",
    "function first() {}\nfunction second() {}\nfunction third() {}\n",
  );
  const nodes = file.tree.rootNode.namedChildren;
  assert.ok(nodes[0]);
  assert.ok(nodes[1]);
  assert.ok(nodes[2]);
  const handles = new HandleStore(2);
  const first = handles.issue(file, nodes[0]);
  const second = handles.issue(file, nodes[1]);
  assert.equal(handles.get(first.id)?.id, first.id);
  handles.issue(file, nodes[2]);
  assert.equal(handles.get(first.id)?.id, first.id);
  assert.equal(handles.get(second.id), undefined);
  assert.equal(handles.size(file.path), 2);
});

test("resolves a handle only when type and source still match", async () => {
  const file = await parseSource("/tmp/handles.ts", "function answer() { return 1; }\n");
  const node = file.tree.rootNode.namedChildren[0];
  assert.ok(node);
  const handles = new HandleStore();
  const handle = handles.issue(file, node);
  assert.equal(handle.type, "function_declaration");
  assert.equal(handle.languageId, file.languageId);
  assert.equal(handle.grammarId, file.grammarId);
  assert.equal(handles.findReplacement(file, handle)?.type, "function_declaration");
});

test("does not resolve handles across grammar boundaries", async () => {
  const path = "/tmp/handles.ts";
  const source = "function answer() { return 1; }\n";
  const primary = await parseSource(path, source);
  const node = primary.tree.rootNode.namedChildren[0];
  assert.ok(node);
  const handles = new HandleStore();
  const handle = handles.issue(primary, node);
  const alternateAdapter: LanguageAdapter = {
    ...typescriptAdapter,
    grammar: {
      ...typescriptAdapter.grammar,
      id: `${typescriptAdapter.grammar.id}/alternate`,
    },
  };
  const alternate = await parseSource(path, source, { adapter: alternateAdapter });
  assert.equal(handles.findReplacement(alternate, handle), undefined);
  assert.equal(resolveHandle(alternate, handles, handle), undefined);
});

test("uses declaration context to rematch a nested duplicate uniquely", async () => {
  const path = "/tmp/handles-nested.ts";
  const source = "function first() { return 1; }\nfunction second() { return 1; }\n";
  const before = await parseSource(path, source);
  const second = before.tree.rootNode.namedChildren[1];
  assert.ok(second);
  const returned = second.namedChildren
    .find((item) => item?.type === "statement_block")
    ?.namedChildren.find((item) => item?.type === "return_statement");
  assert.ok(returned);
  const handles = new HandleStore();
  const handle = handles.issue(before, returned);
  assert.equal(handle.parentDeclarationName, "second");
  const after = await parseSource(path, `// header\n${source}`);
  assert.equal(resolveHandle(after, handles, handle)?.startPosition.row, 2);
});

test("does not select a nearby node when rematching has multiple candidates", async () => {
  const path = "/tmp/handles.ts";
  const source = "function answer() { return 1; }\n";
  const before = await parseSource(path, source);
  const node = before.tree.rootNode.namedChildren[0];
  assert.ok(node);
  const handles = new HandleStore();
  const handle = handles.issue(before, node);
  const after = await parseSource(path, `${source}${"\n".repeat(25)}${source}`);
  assert.equal(handles.findReplacement(after, handle), undefined);
});
