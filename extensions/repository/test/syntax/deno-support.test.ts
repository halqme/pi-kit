import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { denoAdapter } from "../../src/syntax/languages/deno/config.ts";
import {
  adapterForLanguage,
  adapterForPath,
  supportedLanguageIds,
} from "../../src/syntax/language-profile.ts";
import { LspManager } from "../../src/syntax/lsp.ts";
import { HandleStore } from "../../src/syntax/node-handles.ts";
import { locateDetailed } from "../../src/context/locate.ts";
import { clearFileCache, parseSource } from "../../src/syntax/parser.ts";
import { syntaxSearchDetailed } from "../../src/context/syntax-search.ts";

const denoAvailable = spawnSync("deno", ["--version"], { stdio: "ignore" }).status === 0;

test("registers Deno independently while preserving TypeScript extension detection", () => {
  const typescript = adapterForLanguage("typescript");
  const deno = adapterForLanguage("deno");

  assert.equal(deno, denoAdapter);
  assert.equal(deno.id, "deno");
  assert.notEqual(deno.id, typescript.id);
  assert.equal(deno.grammar.id, typescript.grammar.id);
  assert.deepEqual(deno.lsp?.servers, [{ command: "deno", args: ["lsp"] }]);
  assert.deepEqual(deno.lsp?.initializationOptions, { enable: true });
  assert.equal(deno.lspLanguageId, "typescript");
  assert.ok(supportedLanguageIds.includes("deno"));
  assert.equal(adapterForPath("sample.ts")?.id, "typescript");
  assert.equal(adapterForPath("sample.ts", "deno")?.id, "deno");
});

test("parses Deno source without requiring the Deno binary", async () => {
  const file = await parseSource(
    "fixture.ts",
    'import { serve } from "https://deno.land/std/http/server.ts";\nexport function handler(request: Request): Response { return serve(request); }\n',
    { adapter: denoAdapter },
  );

  assert.equal(file.languageId, "deno");
  assert.equal(file.grammarId, denoAdapter.grammar.id);
  assert.equal(file.tree.rootNode.type, "program");
  assert.equal(file.syntaxErrors, 0);
});

test("uses Deno-specific Tree-Sitter queries and explicit locate/search selection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-deno-syntax-"));
  const path = join(dir, "sample.ts");
  await writeFile(
    path,
    'import { serve } from "https://deno.land/std/http/server.ts";\nexport type Answer = number;\nexport function handler(request: Request): Response { return serve(request); }\nhandler(new Request("https://example.com"));\n',
  );
  const handles = new HandleStore();

  const located = await locateDetailed(
    { scope: path, language: "deno", symbols: ["handler"] },
    dir,
    handles,
  );
  assert.equal(located.length, 1);
  assert.equal(located[0]?.name, "handler");
  assert.equal(located[0]?.handle.languageId, "deno");

  const functions = await syntaxSearchDetailed(
    { path, language: "deno", kind: "function", name: "handler" },
    dir,
    handles,
  );
  const calls = await syntaxSearchDetailed(
    { path, language: "deno", kind: "call", name: "handler" },
    dir,
    handles,
  );
  const imports = await syntaxSearchDetailed(
    { path, language: "deno", kind: "import", source: "https://deno.land/std/http/server.ts" },
    dir,
    handles,
  );

  assert.equal(functions.length, 1);
  assert.equal(functions[0]?.handle.languageId, "deno");
  assert.equal(calls.length, 1);
  assert.equal(imports.length, 1);
  clearFileCache(path);
});

test("uses deno lsp when the deno binary is available", { skip: !denoAvailable }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-deno-lsp-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "export function answer(): number { return 42; }\n");
  const manager = new LspManager();

  try {
    const edit = await manager.rename(
      adapterForLanguage("deno"),
      dir,
      path,
      { line: 0, character: 16 },
      "renamedAnswer",
    );
    const edits = edit.changes?.[pathToFileURL(path).href] ?? [];
    assert.ok(edits.some((item) => item.newText === "renamedAnswer"));
  } finally {
    await manager.shutdown();
  }
});
