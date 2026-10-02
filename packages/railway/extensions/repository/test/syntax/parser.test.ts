import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { typescriptAdapter } from "../../src/syntax/languages/typescript/config.ts";
import type { LanguageAdapter } from "../../src/syntax/language-profile.ts";
import {
  byteIndexToStringIndex,
  cacheFile,
  clearFileCache,
  createTreeEdit,
  parseFile,
  parseSource,
  shutdownParserCaches,
  sourceOf,
  startParserCaches,
  stringIndexToByteIndex,
  withParserActivity,
} from "../../src/syntax/parser.ts";

test("parses TypeScript and preserves source ranges", async () => {
  const file = await parseSource("fixture.ts", "const answer: number = 42;\n");
  assert.equal(file.syntaxErrors, 0);
  assert.equal(file.languageId, "typescript");
  assert.equal(file.grammarId, typescriptAdapter.grammar.id);
  const declaration = file.tree.rootNode.namedChildren.find(
    (node) => node?.type === "lexical_declaration",
  );
  assert.ok(declaration);
  assert.equal(sourceOf(file, declaration), "const answer: number = 42;");
});

test("converts between Tree-sitter string indices and UTF-8 byte offsets", async () => {
  const message = "こんにちは🌍";
  const emojiIndex = message.indexOf("🌍");
  const emojiEnd = emojiIndex + "🌍".length;
  assert.equal(stringIndexToByteIndex(message, emojiIndex), 15);
  assert.equal(stringIndexToByteIndex(message, emojiEnd), 19);
  assert.equal(byteIndexToStringIndex(message, 15), emojiIndex);
  assert.equal(byteIndexToStringIndex(message, 19), message.length);
  assert.throws(() => stringIndexToByteIndex(message, emojiIndex + 1), /surrogate pair/);
  assert.throws(() => byteIndexToStringIndex(message, 16), /UTF-8 code point/);
});

test("uses UTF-8 byte ranges safely for non-ASCII source", async () => {
  const file = await parseSource("fixture.ts", '// こんにちは🌍\nconst 名前 = "太郎";\n');
  const declaration = file.tree.rootNode.namedChildren.find(
    (node) => node?.type === "lexical_declaration",
  );
  assert.ok(declaration);
  assert.equal(sourceOf(file, declaration), 'const 名前 = "太郎";');
  assert.equal(declaration.startIndex, "// こんにちは🌍\n".length);
  assert.deepEqual(declaration.startPosition, { row: 1, column: 0 });
});

test("builds edit points across Unicode and CRLF replacement text", () => {
  const source = "// こんにちは🌍\r\nconst value = 1;\n";
  const startIndex = source.indexOf("1");
  const edit = createTreeEdit(source, startIndex, startIndex + 1, "42\r\n// あ");
  assert.deepEqual(edit.startPosition, { row: 1, column: 14 });
  assert.deepEqual(edit.oldEndPosition, { row: 1, column: 15 });
  assert.equal(edit.startIndex, startIndex);
  assert.equal(edit.oldEndIndex, startIndex + 1);
  assert.equal(edit.newEndIndex, startIndex + "42\r\n// あ".length);
  assert.deepEqual(edit.newEndPosition, { row: 2, column: 4 });
});

test("uses an edited tree for incremental parsing with Unicode before the edit", async () => {
  const source = "// こんにちは🌍\nconst value = 1;\n";
  const before = await parseSource("fixture.ts", source);
  const startIndex = source.indexOf("1");
  const edit = createTreeEdit(source, startIndex, startIndex + 1, "42");
  const after = await parseSource(
    "fixture.ts",
    `${source.slice(0, startIndex)}42${source.slice(startIndex + 1)}`,
    { previous: { file: before, edit } },
  );
  assert.equal(after.parseMode, "incremental");
  assert.equal(after.syntaxErrors, 0);
  assert.match(after.tree.rootNode.namedChildren[1]?.text ?? "", /value = 42/);
});

test("separates file and parser caches by grammar identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-parser-"));
  const path = join(dir, "fixture.ts");
  const source = "const answer = 42;\n";
  await writeFile(path, source);
  const alternateAdapter: LanguageAdapter = {
    ...typescriptAdapter,
    grammar: {
      ...typescriptAdapter.grammar,
      id: `${typescriptAdapter.grammar.id}/alternate`,
    },
  };

  const concurrent = await Promise.all(
    Array.from({ length: 20 }, () => parseFile(path, typescriptAdapter)),
  );
  const primary = concurrent[0];
  assert.ok(primary);
  assert.ok(concurrent.every((file) => file === primary));
  assert.ok(concurrent.every((file) => file.tree.rootNode.type === "program"));

  const alternate = await parseFile(path, alternateAdapter);
  assert.notEqual(primary, alternate);
  assert.equal(await parseFile(path, typescriptAdapter), primary);
  assert.equal(await parseFile(path, alternateAdapter), alternate);
  assert.notEqual(primary.grammarId, alternate.grammarId);

  const edit = createTreeEdit(source, source.indexOf("42"), source.indexOf("42") + 2, "43");
  await assert.rejects(
    parseSource(path, "const answer = 43;\n", {
      adapter: alternateAdapter,
      previous: { file: primary, edit },
    }),
    /grammar_mismatch/,
  );
  clearFileCache(path);
});

test("keeps a replaced cached tree alive until cache cleanup", async () => {
  const path = "/tmp/astrolabe-retired.ts";
  const first = await parseSource(path, "const answer = 1;\n");
  const second = await parseSource(path, "const answer = 2;\n");
  cacheFile(first);
  cacheFile(second);
  assert.equal(first.tree.rootNode.type, "program");
  assert.match(first.tree.rootNode.text, /answer = 1/);
  clearFileCache(path);
});

test("collects ERROR and missing nodes with their positions", async () => {
  const file = await parseSource("fixture.ts", "function broken() {\nconst x = ;\n");
  assert.ok(file.syntaxErrors > 0);
  assert.ok(file.syntaxIssues.some((issue) => issue.kind === "ERROR"));
  assert.ok(file.syntaxIssues.some((issue) => issue.kind === "MISSING"));
  assert.ok(file.syntaxIssues.every((issue) => issue.startPosition.row >= 0));
});

test("blocks parsing during shutdown and can start a fresh cache lifecycle", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-parser-"));
  const path = join(dir, "fixture.ts");
  await writeFile(path, "const answer = 42;\n");
  await parseFile(path);
  let releaseActivity: (() => void) | undefined;
  const activity = withParserActivity(
    () =>
      new Promise<void>((resolve) => {
        releaseActivity = resolve;
      }),
  );
  let shutdownFinished = false;
  const shutdown = shutdownParserCaches().then(() => {
    shutdownFinished = true;
  });
  await Promise.resolve();
  assert.equal(shutdownFinished, false);
  await assert.rejects(parseFile(path), /parser_shutdown/);
  assert.ok(releaseActivity);
  releaseActivity();
  await activity;
  await shutdown;
  startParserCaches();
  assert.equal((await parseFile(path)).tree.rootNode.type, "program");
  clearFileCache(path);
});
