import assert from "node:assert/strict";
import test from "node:test";
import {
  adapterForLanguage,
  adapterForPath,
  supportedLanguageIds,
} from "../../src/syntax/language-profile.ts";
import { clearFileCache, parseSource } from "../../src/syntax/parser.ts";

test("registers TSX as an auto-detected repository language", () => {
  const adapter = adapterForLanguage("tsx");
  assert.equal(adapterForPath("src/App.tsx"), adapter);
  assert.equal(adapter.grammar.wasmFile, "out/tree-sitter-tsx.wasm");
  assert.equal(adapter.lspLanguageId, "typescriptreact");
  assert.ok(supportedLanguageIds.includes("tsx"));
});

test("parses TypeScript JSX with the TSX grammar", async () => {
  const path = "/tmp/astrolabe-tsx-fixture.tsx";
  const source = [
    "type Props = { title: string };",
    "export function App({ title }: Props) {",
    "  return <main><h1>{title}</h1></main>;",
    "}",
    "",
  ].join("\n");
  const file = await parseSource(path, source);

  assert.equal(file.languageId, "tsx");
  assert.equal(file.grammarId, adapterForLanguage("tsx").grammar.id);
  assert.equal(file.syntaxErrors, 0);

  clearFileCache(path);
});
