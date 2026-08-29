import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HandleStore } from "../src/node-handles.ts";
import { clearFileCache } from "../src/parser.ts";
import { locateDetailed } from "../src/locate.ts";

test("locate ranks an exact qualified symbol above term-only declarations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-locate-"));
  const path = join(dir, "sample.ts");
  await writeFile(
    path,
    [
      "class Parser { parse(input: string) { return input.trim(); } }",
      'function fallback() { throw new Error("parse failed"); }',
      "",
    ].join("\n"),
  );
  const matches = await locateDetailed(
    { scope: path, symbols: ["Parser.parse"], terms: ["parse"] },
    dir,
    new HandleStore(),
  );
  assert.equal(matches[0]?.name, "parse");
  assert.match(matches[0]?.source ?? "", /return input\.trim/);
  assert.deepEqual(matches[0]?.reasons, [
    "tree-sitter:symbol:Parser.parse:qualified",
    "text:term:parse",
  ]);
  clearFileCache(path);
});

test("locate matches terms case-insensitively and orders equal scores by path and position", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-locate-"));
  const first = join(dir, "a.ts");
  const second = join(dir, "b.ts");
  await writeFile(
    first,
    'function first() { return "PARSE"; }\nfunction second() { return "parse"; }\n',
  );
  await writeFile(second, 'function third() { return "parse"; }\n');
  const matches = await locateDetailed({ scope: dir, terms: ["parse"] }, dir, new HandleStore());
  assert.deepEqual(
    matches.map((match) => [match.path, match.name]),
    [
      [first, "first"],
      [first, "second"],
      [second, "third"],
    ],
  );
  clearFileCache(first);
  clearFileCache(second);
});

test("locate flow omits outer calls whose callees contain another call", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-locate-"));
  const path = join(dir, "sample.ts");
  await writeFile(
    path,
    'function example() { return sourceOf(file, node.childForFieldName("name")).split(/\\s/, 1); }\n',
  );
  const matches = await locateDetailed(
    { scope: path, symbols: ["example"] },
    dir,
    new HandleStore(),
  );
  assert.deepEqual(matches[0]?.flow.calls, ["sourceOf", "node.childForFieldName"]);
  clearFileCache(path);
});

test("locate returns no candidates when its hints do not match a declaration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-locate-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "function answer() { return 42; }\n");
  assert.deepEqual(
    await locateDetailed(
      { scope: path, symbols: ["missing"], terms: ["absent"] },
      dir,
      new HandleStore(),
    ),
    [],
  );
  clearFileCache(path);
});
