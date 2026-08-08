import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { adapterForPath, type LanguageAdapter } from "./language-profile.ts";
import type { LspRange, LspTextEdit, LspWorkspaceEdit } from "./lsp.ts";
import { HandleStore } from "./node-handles.ts";
import {
  cacheFile,
  createTreeEdit,
  isStringBoundary,
  parseFile,
  parseSource,
  type ParsedFile,
} from "./parser.ts";
import { resolveExistingPath } from "./path.ts";
import { describeSyntaxIssues, findNewSyntaxIssuesForEdits } from "./syntax-validation.ts";

export class WorkspaceMutationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceMutationError";
  }
}

interface VersionedTextDocumentEdit {
  textDocument: { uri: string; version?: number | null };
  edits: LspTextEdit[];
}

interface ConvertedEdit extends LspTextEdit {
  startIndex: number;
  endIndex: number;
}

interface PreparedFile {
  path: string;
  adapter: LanguageAdapter;
  before: ParsedFile;
  after: ParsedFile;
  nextSource: string;
  edits: ConvertedEdit[];
  mode: number;
  tempPath?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPosition(value: unknown): value is { line: number; character: number } {
  return (
    isRecord(value) &&
    Number.isInteger(value.line) &&
    (value.line as number) >= 0 &&
    Number.isInteger(value.character) &&
    (value.character as number) >= 0
  );
}

function isRange(value: unknown): value is LspRange {
  return isRecord(value) && isPosition(value.start) && isPosition(value.end);
}

function isTextEdit(value: unknown): value is LspTextEdit {
  return isRecord(value) && isRange(value.range) && typeof value.newText === "string";
}

function isTextDocumentEdit(value: unknown): value is VersionedTextDocumentEdit {
  return (
    isRecord(value) &&
    isRecord(value.textDocument) &&
    typeof value.textDocument.uri === "string" &&
    Array.isArray(value.edits) &&
    value.edits.every(isTextEdit)
  );
}

function addEdits(
  target: Map<string, LspTextEdit[]>,
  uri: string,
  edits: readonly LspTextEdit[],
): void {
  const existing = target.get(uri) ?? [];
  existing.push(...edits);
  target.set(uri, existing);
}

function collectWorkspaceEdits(edit: LspWorkspaceEdit): Map<string, LspTextEdit[]> {
  const byUri = new Map<string, LspTextEdit[]>();
  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      if (!Array.isArray(edits) || !edits.every(isTextEdit)) {
        throw new WorkspaceMutationError(
          "invalid_workspace_edit",
          `Invalid text edits for ${uri}.`,
        );
      }
      addEdits(byUri, uri, edits);
    }
  }
  for (const change of edit.documentChanges ?? []) {
    if (!isRecord(change)) {
      throw new WorkspaceMutationError(
        "invalid_workspace_edit",
        "WorkspaceEdit contains an invalid document change.",
      );
    }
    if (typeof change.kind === "string") {
      throw new WorkspaceMutationError(
        "unsupported_workspace_operation",
        `WorkspaceEdit resource operation ${change.kind} is not supported; no files were changed.`,
      );
    }
    if (!isTextDocumentEdit(change)) {
      throw new WorkspaceMutationError(
        "unsupported_workspace_operation",
        "WorkspaceEdit contains a non-text document change; no files were changed.",
      );
    }
    addEdits(byUri, change.textDocument.uri, change.edits);
  }
  if (byUri.size === 0 || [...byUri.values()].every((edits) => edits.length === 0)) {
    throw new WorkspaceMutationError(
      "rename_no_edits",
      "The language server returned an empty WorkspaceEdit.",
    );
  }
  return byUri;
}

function positionToStringIndex(
  source: string,
  position: { line: number; character: number },
): number {
  let line = 0;
  let start = 0;
  while (line < position.line) {
    const newline = source.indexOf("\n", start);
    if (newline < 0) {
      throw new WorkspaceMutationError(
        "invalid_workspace_edit",
        "WorkspaceEdit line is outside the file.",
      );
    }
    start = newline + 1;
    line++;
  }
  const newline = source.indexOf("\n", start);
  let lineEnd = newline < 0 ? source.length : newline;
  if (lineEnd > start && source.charCodeAt(lineEnd - 1) === 13) lineEnd--;
  const index = start + position.character;
  if (index < start || index > lineEnd || !isStringBoundary(source, index)) {
    throw new WorkspaceMutationError(
      "invalid_workspace_edit",
      "WorkspaceEdit character is outside the UTF-16 line boundary.",
    );
  }
  return index;
}

function convertEdits(source: string, edits: readonly LspTextEdit[]): ConvertedEdit[] {
  const converted = edits.map((edit) => ({
    ...edit,
    startIndex: positionToStringIndex(source, edit.range.start),
    endIndex: positionToStringIndex(source, edit.range.end),
  }));
  converted.sort(
    (left, right) => left.startIndex - right.startIndex || left.endIndex - right.endIndex,
  );
  for (const edit of converted) {
    if (edit.endIndex < edit.startIndex) {
      throw new WorkspaceMutationError(
        "invalid_workspace_edit",
        "WorkspaceEdit has a reversed range.",
      );
    }
  }
  for (let index = 1; index < converted.length; index++) {
    const previous = converted[index - 1];
    const current = converted[index];
    if (!previous || !current) continue;
    if (
      current.startIndex < previous.endIndex ||
      (current.startIndex === previous.startIndex && current.endIndex === previous.endIndex)
    ) {
      throw new WorkspaceMutationError(
        "overlapping_workspace_edits",
        "WorkspaceEdit contains overlapping or duplicate edits; no files were changed.",
      );
    }
  }
  return converted;
}

function applyConvertedEdits(source: string, edits: readonly ConvertedEdit[]): string {
  let result = source;
  for (const edit of [...edits].reverse()) {
    result = result.slice(0, edit.startIndex) + edit.newText + result.slice(edit.endIndex);
  }
  return result;
}

async function prepareFile(path: string, edits: readonly LspTextEdit[]): Promise<PreparedFile> {
  const adapter = adapterForPath(path);
  if (!adapter) {
    throw new WorkspaceMutationError(
      "unsupported_workspace_file",
      `WorkspaceEdit touches an Astrolabe-unsupported file: ${path}`,
    );
  }
  const before = await parseFile(path, adapter);
  const converted = convertEdits(before.source, edits);
  const nextSource = applyConvertedEdits(before.source, converted);
  const after = await parseSource(path, nextSource, { adapter });
  const treeEdits = converted.map((edit) =>
    createTreeEdit(before.source, edit.startIndex, edit.endIndex, edit.newText),
  );
  const issues = findNewSyntaxIssuesForEdits(before, after, treeEdits);
  if (issues.length > 0) {
    after.tree.delete();
    throw new WorkspaceMutationError("syntax_error", describeSyntaxIssues(issues));
  }
  return {
    path,
    adapter,
    before,
    after,
    nextSource,
    edits: converted,
    mode: (await stat(path)).mode & 0o7777,
  };
}

async function withMutationQueues<T>(
  paths: readonly string[],
  operation: () => Promise<T>,
): Promise<T> {
  const ordered = [...new Set(paths)].sort();
  const acquire = (index: number): Promise<T> => {
    const path = ordered[index];
    if (!path) return operation();
    return withFileMutationQueue(path, () => acquire(index + 1));
  };
  return acquire(0);
}

async function stageFiles(prepared: PreparedFile[]): Promise<void> {
  try {
    for (const file of prepared) {
      const tempPath = `${file.path}.${randomUUID()}.tmp`;
      await writeFile(tempPath, file.nextSource, "utf8");
      await chmod(tempPath, file.mode);
      file.tempPath = tempPath;
    }
  } catch (error) {
    await Promise.allSettled(
      prepared.flatMap((file) => (file.tempPath ? [unlink(file.tempPath)] : [])),
    );
    throw error;
  }
}

async function restoreFile(file: PreparedFile): Promise<void> {
  const rollback = `${file.path}.${randomUUID()}.rollback`;
  try {
    await writeFile(rollback, file.before.source, "utf8");
    await chmod(rollback, file.mode);
    await rename(rollback, file.path);
  } finally {
    await unlink(rollback).catch(() => undefined);
  }
}

async function commitPrepared(prepared: PreparedFile[]): Promise<void> {
  await stageFiles(prepared);
  const committed: PreparedFile[] = [];
  try {
    for (const file of prepared) {
      if (!file.tempPath) throw new Error(`Missing staged file for ${file.path}`);
      await rename(file.tempPath, file.path);
      delete file.tempPath;
      committed.push(file);
    }
  } catch (error) {
    const rollback = await Promise.allSettled([...committed].reverse().map(restoreFile));
    const rollbackFailed = rollback.some((result) => result.status === "rejected");
    throw new WorkspaceMutationError(
      rollbackFailed ? "workspace_commit_partial" : "workspace_commit_failed",
      rollbackFailed
        ? `WorkspaceEdit commit failed and rollback was incomplete: ${String(error)}`
        : `WorkspaceEdit commit failed and was rolled back: ${String(error)}`,
    );
  } finally {
    await Promise.allSettled(
      prepared.flatMap((file) => (file.tempPath ? [unlink(file.tempPath)] : [])),
    );
  }
}

export interface WorkspaceMutationDetails {
  files: number;
  edits: number;
  paths: string[];
}

export async function applyWorkspaceEdit(
  edit: LspWorkspaceEdit,
  cwd: string,
  handles: HandleStore,
): Promise<WorkspaceMutationDetails> {
  const byUri = collectWorkspaceEdits(edit);
  const byPath = new Map<string, LspTextEdit[]>();
  for (const [uri, edits] of byUri) {
    if (!uri.startsWith("file:")) {
      throw new WorkspaceMutationError(
        "unsupported_workspace_uri",
        `WorkspaceEdit contains a non-file URI: ${uri}`,
      );
    }
    const path = await resolveExistingPath(cwd, fileURLToPath(uri));
    const existing = byPath.get(path) ?? [];
    existing.push(...edits);
    byPath.set(path, existing);
  }

  return withMutationQueues([...byPath.keys()], async () => {
    const prepared: PreparedFile[] = [];
    try {
      for (const [path, edits] of [...byPath].sort(([left], [right]) =>
        left.localeCompare(right),
      )) {
        prepared.push(await prepareFile(path, edits));
      }
      for (const file of prepared) {
        const current = await readFile(file.path, "utf8");
        if (current !== file.before.source) {
          throw new WorkspaceMutationError(
            "stale_workspace_edit",
            `WorkspaceEdit target changed while the edit was being prepared: ${file.path}. Re-run the semantic operation.`,
          );
        }
      }
      await commitPrepared(prepared);
      for (const file of prepared) {
        cacheFile(file.after);
        handles.clear(file.path);
      }
      return {
        files: prepared.length,
        edits: prepared.reduce((count, file) => count + file.edits.length, 0),
        paths: prepared.map((file) => file.path),
      };
    } catch (error) {
      for (const file of prepared) {
        if (file.tempPath) await unlink(file.tempPath).catch(() => undefined);
        file.after.tree.delete();
      }
      throw error;
    }
  });
}
