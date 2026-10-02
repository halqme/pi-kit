import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { syntaxSearchDetailed } from "../../src/context/syntax-search.ts";
import {
  adapterForLanguage,
  adapterForPath,
  supportedLanguageIds,
} from "../../src/syntax/language-profile.ts";
import { HandleStore } from "../../src/syntax/node-handles.ts";
import { clearFileCache, parseSource } from "../../src/syntax/parser.ts";
import { outline } from "../../src/syntax/render.ts";

test("registers Swift as an auto-detected repository language", () => {
  assert.equal(adapterForPath("Sources/App.swift")?.id, "swift");
  assert.equal(adapterForLanguage("swift").lsp?.servers[0]?.command, "sourcekit-lsp");
  assert.ok(supportedLanguageIds.includes("swift"));
});

test("parses and structurally searches Swift source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-swift-"));
  const path = join(dir, "ContentView.swift");
  const source = `import SwiftUI

struct ContentView: View {
    var body: some View { Text("Hello") }

    func greet() {
        print("hello")
    }
}
`;
  await writeFile(path, source);
  const adapter = adapterForLanguage("swift");
  const file = await parseSource(path, source, { adapter });
  const handles = new HandleStore();

  assert.equal(file.languageId, "swift");
  assert.equal(file.syntaxErrors, 0);
  assert.match(outline(file, file.tree.rootNode, handles, 2), /ContentView/);

  const functions = await syntaxSearchDetailed(
    { path, kind: "function", name: "greet" },
    dir,
    handles,
  );
  const imports = await syntaxSearchDetailed(
    { path, kind: "import", source: "SwiftUI" },
    dir,
    handles,
  );
  assert.equal(functions.length, 1);
  assert.equal(functions[0]?.handle.languageId, "swift");
  assert.equal(imports.length, 1);
  clearFileCache(path);
});
