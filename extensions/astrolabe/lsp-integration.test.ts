import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { adapterForLanguage } from "./src/language-profile.ts";
import type { LspService, LspWorkspaceEdit } from "./src/lsp.ts";
import { HandleStore } from "./src/node-handles.ts";
import { renameContinuationDetailed } from "./src/rename.ts";
import { locateResolvedDetailed } from "./src/semantic-locate.ts";

function fakeLsp(options: {
  symbols?: LspService["workspaceSymbols"];
  rename?: LspService["rename"];
}): LspService {
  return {
    workspaceSymbols: options.symbols ?? (async () => []),
    rename:
      options.rename ??
      (async () => {
        throw new Error("unexpected rename");
      }),
    async shutdown() {},
  };
}

test("locate can use LSP workspace symbols as a semantic ranking source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-lsp-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "function actualName() { return 1; }\n");
  const lsp = fakeLsp({
    symbols: async (adapter, cwd, query) => {
      assert.equal(adapter.id, "typescript");
      assert.equal(cwd, dir);
      assert.equal(query, "requestedAlias");
      return [
        {
          name: "actualName",
          uri: pathToFileURL(path).href,
          range: { start: { line: 0, character: 9 }, end: { line: 0, character: 19 } },
        },
      ];
    },
  });
  const matches = await locateResolvedDetailed(
    { scope: "sample.ts", symbols: ["requestedAlias"] },
    dir,
    new HandleStore(),
    lsp,
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.name, "actualName");
  assert.ok(matches[0]?.reasons.includes("lsp:workspaceSymbol:requestedAlias"));
});

test("rename keeps node selection but commits the LSP WorkspaceEdit through Astrolabe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-lsp-"));
  const declarationPath = join(dir, "a.ts");
  const usePath = join(dir, "b.ts");
  await writeFile(declarationPath, "export function oldName() { return 1; }\n");
  await writeFile(usePath, 'import { oldName } from "./a";\noldName();\n');
  const handles = new HandleStore();
  const located = await locateResolvedDetailed(
    { scope: "a.ts", symbols: ["oldName"] },
    dir,
    handles,
    fakeLsp({}),
  );
  const handle = located[0]?.handle;
  assert.ok(handle);
  const token = handles.issueContinuation(handle.id);
  assert.ok(token);

  const workspaceEdit: LspWorkspaceEdit = {
    changes: {
      [pathToFileURL(declarationPath).href]: [
        { range: { start: { line: 0, character: 16 }, end: { line: 0, character: 23 } }, newText: "newName" },
      ],
      [pathToFileURL(usePath).href]: [
        { range: { start: { line: 0, character: 9 }, end: { line: 0, character: 16 } }, newText: "newName" },
        { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 7 } }, newText: "newName" },
      ],
    },
  };
  const lsp = fakeLsp({
    rename: async (adapter, cwd, path, position, newName) => {
      assert.equal(adapter, adapterForLanguage("typescript"));
      assert.equal(cwd, dir);
      assert.equal(path, declarationPath);
      assert.deepEqual(position, { line: 0, character: 16 });
      assert.equal(newName, "newName");
      return workspaceEdit;
    },
  });

  const renamed = await renameContinuationDetailed(
    { action: "rename", continuation: { token }, newName: "newName" },
    dir,
    handles,
    lsp,
  );
  assert.match(renamed.message, /^renamed symbol/);
  assert.match(await readFile(declarationPath, "utf8"), /function newName/);
  assert.match(await readFile(usePath, "utf8"), /import \{ newName \}/);
  assert.match(await readFile(usePath, "utf8"), /newName\(\)/);
  assert.equal(handles.resolveContinuation(token), undefined);
});
