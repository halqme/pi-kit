import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as ParserModule from "web-tree-sitter";
import type { Edit, Node, Parser, Point, Tree } from "web-tree-sitter";
import { requireAdapterForPath, type LanguageAdapter } from "./language-profile.ts";

const require = createRequire(import.meta.url);
let runtimeInitPromise: Promise<void> | undefined;
const parserPromises = new Map<string, Promise<Parser>>();
const filePromises = new Map<string, Promise<ParsedFile>>();
const cache = new Map<string, ParsedFile>();
const retiredFiles = new Set<ParsedFile>();
const activeOperations = new Set<Promise<void>>();
let shuttingDown = false;

export async function withParserActivity<T>(operation: () => Promise<T>): Promise<T> {
  if (shuttingDown) throw new Error("parser_shutdown: Astrolabe is shutting down.");
  const pending = operation();
  const completion = pending.then(
    () => undefined,
    () => undefined,
  );
  activeOperations.add(completion);
  try {
    return await pending;
  } finally {
    activeOperations.delete(completion);
  }
}

async function createParser(adapter: LanguageAdapter): Promise<Parser> {
  runtimeInitPromise ??= ParserModule.Parser.init();
  await runtimeInitPromise;
  const parser = new ParserModule.Parser();
  const packageRoot = dirname(require.resolve(`${adapter.grammar.packageName}/package.json`));
  const language = await ParserModule.Language.load(join(packageRoot, adapter.grammar.wasmFile));
  parser.setLanguage(language);
  return parser;
}

export interface SyntaxIssue {
  kind: "ERROR" | "MISSING";
  type: string;
  startIndex: number;
  endIndex: number;
  startPosition: Point;
  endPosition: Point;
}

export interface ParsedFile {
  path: string;
  languageId: string;
  grammarId: string;
  source: string;
  bytes: Buffer;
  hash: string;
  tree: Tree;
  syntaxErrors: number;
  syntaxIssues: SyntaxIssue[];
  parseMode: "full" | "incremental";
  parseTimeMs: number;
}

/** Tree-sitter's string parser exposes UTF-16 JavaScript string indices. */
export type TreeEdit = Edit;

export function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function treeIndexToStringIndex(_source: string, treeIndex: number): number {
  return treeIndex;
}

export function isStringBoundary(source: string, stringIndex: number): boolean {
  if (stringIndex === 0 || stringIndex === source.length) return true;
  const previous = source.charCodeAt(stringIndex - 1);
  const current = source.charCodeAt(stringIndex);
  return !(previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff);
}

function assertStringBoundary(source: string, stringIndex: number): void {
  if (!Number.isInteger(stringIndex) || stringIndex < 0 || stringIndex > source.length) {
    throw new RangeError("string index is outside the source");
  }
  if (!isStringBoundary(source, stringIndex)) {
    throw new RangeError("string index splits a UTF-16 surrogate pair");
  }
}

export function stringIndexToByteIndex(source: string, stringIndex: number): number {
  assertStringBoundary(source, stringIndex);
  return Buffer.byteLength(source.slice(0, stringIndex), "utf8");
}

/** Convert a UTF-8 byte offset to a JavaScript UTF-16 string index. */
export function byteIndexToStringIndex(source: string, byteIndex: number): number {
  if (!Number.isInteger(byteIndex) || byteIndex < 0) {
    throw new RangeError("byte index must be a non-negative integer");
  }
  let bytes = 0;
  let index = 0;
  while (index < source.length) {
    if (bytes === byteIndex) return index;
    const codePoint = source.codePointAt(index);
    if (codePoint === undefined) break;
    const widthInString = codePoint > 0xffff ? 2 : 1;
    const widthInBytes = Buffer.byteLength(source.slice(index, index + widthInString), "utf8");
    if (bytes + widthInBytes > byteIndex) {
      throw new RangeError("byte index splits a UTF-8 code point");
    }
    bytes += widthInBytes;
    index += widthInString;
  }
  if (bytes === byteIndex) return source.length;
  throw new RangeError("byte index is outside the source");
}

export function sourceRange(source: string, startIndex: number, endIndex: number): string {
  return source.slice(
    treeIndexToStringIndex(source, startIndex),
    treeIndexToStringIndex(source, endIndex),
  );
}

function pointAtStringIndex(source: string, stringIndex: number): Point {
  assertStringBoundary(source, stringIndex);
  const prefix = source.slice(0, stringIndex);
  const lastNewline = prefix.lastIndexOf("\n");
  const row = prefix.split("\n").length - 1;
  return { row, column: stringIndex - lastNewline - 1 };
}

export function advancePoint(start: Point, inserted: string): Point {
  const newlineCount = (inserted.match(/\n/g) ?? []).length;
  if (newlineCount === 0) return { row: start.row, column: start.column + inserted.length };
  const lastNewline = inserted.lastIndexOf("\n");
  return { row: start.row + newlineCount, column: inserted.length - lastNewline - 1 };
}

export function createTreeEdit(
  source: string,
  startIndex: number,
  oldEndIndex: number,
  replacement: string,
): TreeEdit {
  if (
    !Number.isInteger(startIndex) ||
    !Number.isInteger(oldEndIndex) ||
    startIndex < 0 ||
    oldEndIndex < startIndex ||
    oldEndIndex > source.length
  ) {
    throw new RangeError("edit range is outside the source");
  }
  const startPosition = pointAtStringIndex(source, startIndex);
  const oldEndPosition = pointAtStringIndex(source, oldEndIndex);
  return new ParserModule.Edit({
    startIndex,
    oldEndIndex,
    newEndIndex: startIndex + replacement.length,
    startPosition,
    oldEndPosition,
    newEndPosition: advancePoint(startPosition, replacement),
  });
}

function collectSyntaxIssues(tree: Tree): SyntaxIssue[] {
  const issues: SyntaxIssue[] = [];
  const visit = (node: Node): void => {
    if (node.isError || node.type === "ERROR") {
      issues.push({
        kind: "ERROR",
        type: node.type,
        startIndex: node.startIndex,
        endIndex: node.endIndex,
        startPosition: node.startPosition,
        endPosition: node.endPosition,
      });
    } else if (node.isMissing) {
      issues.push({
        kind: "MISSING",
        type: node.type,
        startIndex: node.startIndex,
        endIndex: node.endIndex,
        startPosition: node.startPosition,
        endPosition: node.endPosition,
      });
    }
    for (const child of node.children) if (child) visit(child);
  };
  visit(tree.rootNode);
  return issues;
}

export function syntaxIssues(tree: Tree): SyntaxIssue[] {
  return collectSyntaxIssues(tree);
}

function parser(adapter: LanguageAdapter): Promise<Parser> {
  const key = `${adapter.id}\0${adapter.grammar.id}`;
  const cached = parserPromises.get(key);
  if (cached) return cached;
  const pending = createParser(adapter);
  parserPromises.set(key, pending);
  void pending.catch(() => {
    if (parserPromises.get(key) === pending) parserPromises.delete(key);
  });
  return pending;
}

export function parseSource(
  path: string,
  source: string,
  options: {
    adapter?: LanguageAdapter;
    previous?: { file: ParsedFile; edit?: Edit };
  } = {},
): Promise<ParsedFile> {
  return withParserActivity(async () => {
    const adapter = options.adapter ?? requireAdapterForPath(path);
    const previous = options.previous;
    if (
      previous &&
      (previous.file.languageId !== adapter.id || previous.file.grammarId !== adapter.grammar.id)
    ) {
      throw new Error(
        "grammar_mismatch: Incremental parsing requires the same language and grammar.",
      );
    }
    const activeParser = await parser(adapter);
    const started = Date.now();
    const incremental = Boolean(previous?.edit);
    let tree: Tree | null;
    if (previous?.edit) {
      const oldTree = previous.file.tree.copy();
      oldTree.edit(previous.edit);
      try {
        tree = activeParser.parse(source, oldTree);
      } finally {
        oldTree.delete();
      }
    } else {
      tree = activeParser.parse(source);
    }
    if (!tree) throw new Error("Tree-sitter returned no tree");
    const syntaxIssues = collectSyntaxIssues(tree);
    return {
      path,
      languageId: adapter.id,
      grammarId: adapter.grammar.id,
      source,
      bytes: Buffer.from(source, "utf8"),
      hash: hash(source),
      tree,
      syntaxErrors: syntaxIssues.length,
      syntaxIssues,
      parseMode: incremental ? "incremental" : "full",
      parseTimeMs: Date.now() - started,
    };
  });
}

export async function parseFile(
  path: string,
  adapter: LanguageAdapter = requireAdapterForPath(path),
): Promise<ParsedFile> {
  if (shuttingDown) throw new Error("parser_shutdown: Astrolabe is shutting down.");
  const key = `${path}\0${adapter.id}\0${adapter.grammar.id}`;
  const active = filePromises.get(key);
  if (active) return active;
  const pending = (async (): Promise<ParsedFile> => {
    const bytes = await readFile(path);
    const fileHash = hash(bytes);
    const cached = cache.get(key);
    if (cached?.hash === fileHash) return cached;
    const parsed = await parseSource(path, bytes.toString("utf8"), { adapter });
    cacheFile(parsed);
    return parsed;
  })();
  filePromises.set(key, pending);
  try {
    return await pending;
  } finally {
    if (filePromises.get(key) === pending) filePromises.delete(key);
  }
}

export function cacheFile(file: ParsedFile): void {
  const key = `${file.path}\0${file.languageId}\0${file.grammarId}`;
  const previous = cache.get(key);
  if (previous && previous !== file) retiredFiles.add(previous);
  cache.set(key, file);
}

async function clearParserCache(): Promise<void> {
  const pending = [...parserPromises.values()];
  parserPromises.clear();
  const settled = await Promise.allSettled(pending);
  for (const result of settled) {
    if (result.status === "fulfilled") result.value.delete();
  }
}

function deleteCachedFiles(path?: string): void {
  if (path) {
    for (const [key, file] of cache) {
      if (file.path !== path) continue;
      file.tree.delete();
      cache.delete(key);
    }
    for (const file of retiredFiles) {
      if (file.path !== path) continue;
      file.tree.delete();
      retiredFiles.delete(file);
    }
    return;
  }
  for (const file of cache.values()) file.tree.delete();
  for (const file of retiredFiles) file.tree.delete();
  cache.clear();
  retiredFiles.clear();
}

export function clearFileCache(path?: string): void {
  if (filePromises.size > 0 || activeOperations.size > 0) {
    throw new Error("cache_in_use: Cannot clear parser caches while an operation is active.");
  }
  deleteCachedFiles(path);
}

export function startParserCaches(): void {
  shuttingDown = false;
}

export async function shutdownParserCaches(): Promise<void> {
  shuttingDown = true;
  await Promise.allSettled(filePromises.values());
  await Promise.allSettled(activeOperations);
  deleteCachedFiles();
  await clearParserCache();
}

export function sourceOf(file: ParsedFile, node: Node): string {
  return sourceRange(file.source, node.startIndex, node.endIndex);
}

export function lineAt(source: string, row: number): string {
  const lines = source.split(/\r?\n/);
  return lines[row] ?? "";
}

export function lineHash(source: string, row: number): string {
  return hash(lineAt(source, row));
}
