import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { HandleStore } from "../../src/syntax/node-handles.ts";
import { applyWorkspaceEdit, WorkspaceMutationError } from "../../src/code/workspace-edit.ts";

async function rejectsWithCode(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof WorkspaceMutationError);
    assert.equal(error.code, code);
    return true;
  });
}

test("workspace edit rejects resource operations without mutating files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-workspace-"));
  const path = join(dir, "sample.ts");
  const source = "export function answer() { return 1; }\n";
  await writeFile(path, source);

  await rejectsWithCode(
    applyWorkspaceEdit(
      {
        documentChanges: [
          {
            kind: "rename",
            oldUri: pathToFileURL(path).href,
            newUri: pathToFileURL(join(dir, "renamed.ts")).href,
          },
        ],
      },
      dir,
      new HandleStore(),
    ),
    "unsupported_workspace_operation",
  );
  assert.equal(await readFile(path, "utf8"), source);
});

test("workspace edit rejects overlapping ranges before commit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-workspace-"));
  const path = join(dir, "sample.ts");
  const source = "function answer() { return 1; }\n";
  await writeFile(path, source);

  await rejectsWithCode(
    applyWorkspaceEdit(
      {
        changes: {
          [pathToFileURL(path).href]: [
            {
              range: { start: { line: 0, character: 9 }, end: { line: 0, character: 15 } },
              newText: "first",
            },
            {
              range: { start: { line: 0, character: 10 }, end: { line: 0, character: 15 } },
              newText: "second",
            },
          ],
        },
      },
      dir,
      new HandleStore(),
    ),
    "overlapping_workspace_edits",
  );
  assert.equal(await readFile(path, "utf8"), source);
});

test("workspace edit validates every file before committing any file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-workspace-"));
  const sourcePath = join(dir, "a.ts");
  const unsupportedPath = join(dir, "z.json");
  const source = "export function answer() { return 1; }\n";
  await writeFile(sourcePath, source);
  await writeFile(unsupportedPath, '{"answer":true}\n');

  await rejectsWithCode(
    applyWorkspaceEdit(
      {
        changes: {
          [pathToFileURL(sourcePath).href]: [
            {
              range: { start: { line: 0, character: 16 }, end: { line: 0, character: 22 } },
              newText: "renamed",
            },
          ],
          [pathToFileURL(unsupportedPath).href]: [
            {
              range: { start: { line: 0, character: 2 }, end: { line: 0, character: 8 } },
              newText: "renamed",
            },
          ],
        },
      },
      dir,
      new HandleStore(),
    ),
    "unsupported_workspace_file",
  );
  assert.equal(await readFile(sourcePath, "utf8"), source);
});
