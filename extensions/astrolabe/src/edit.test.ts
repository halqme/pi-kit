import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFile } from "./parser.ts";
import { HandleStore } from "./node-handles.ts";
import { edit } from "./edit.ts";

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
    /edited/,
  );
  assert.match(await readFile(path, "utf8"), /return 2/);
  await writeFile(path, "function answer() { return 3; }\n");
  assert.match(
    await edit({ path, nodeId: handle.id, replacement: "return 4;" }, dir, handles),
    /stale_node/,
  );
});
