import test from "node:test";
import assert from "node:assert/strict";
import { parseSource, sourceOf } from "./parser.ts";

test("parses TypeScript and preserves source ranges", async () => {
  const file = await parseSource("fixture.ts", "const answer: number = 42;\n");
  assert.equal(file.syntaxErrors, 0);
  const declaration = file.tree.rootNode.namedChildren.find((node) => node?.type === "lexical_declaration");
  assert.ok(declaration);
  assert.equal(sourceOf(file, declaration), "const answer: number = 42;");
});

test("uses UTF-8 byte ranges safely for non-ASCII source", async () => {
  const file = await parseSource("fixture.ts", "const 名前 = \"太郎\";\n");
  const declaration = file.tree.rootNode.namedChildren.find((node) => node?.type === "lexical_declaration");
  assert.ok(declaration);
  assert.equal(sourceOf(file, declaration), "const 名前 = \"太郎\";");
});

test("counts syntax errors", async () => {
  const file = await parseSource("fixture.ts", "function broken( {\n");
  assert.ok(file.syntaxErrors > 0);
});
