import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as ParserModule from "web-tree-sitter";
import type { Edit, Node, Parser, Point, Tree } from "web-tree-sitter";

const require = createRequire(import.meta.url);
let parserPromise: Promise<Parser> | undefined;
const cache = new Map<string, ParsedFile>();

async function createParser(): Promise<Parser> {
  await ParserModule.Parser.init();
  const parser = new ParserModule.Parser();
  const packageRoot = dirname(require.resolve("tree-sitter-typescript/package.json"));
  const language = await ParserModule.Language.load(join(packageRoot, "tree-sitter-typescript.wasm"));
  parser.setLanguage(language);
  return parser;
}

export interface ParsedFile {
  path: string;
  source: string;
  bytes: Buffer;
  hash: string;
  tree: Tree;
  syntaxErrors: number;
}
export interface ByteEdit { startIndex: number; oldEndIndex: number; newEndIndex: number; startPosition: Point; oldEndPosition: Point; newEndPosition: Point; }
export function hash(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
// web-tree-sitter exposes JavaScript string (UTF-16) indices. Keep conversion explicit so
// callers do not accidentally apply byte offsets to String#slice.
export function treeIndexToStringIndex(_source: string, treeIndex: number): number { return treeIndex; }
export function stringIndexToByteIndex(source: string, stringIndex: number): number {
  return Buffer.byteLength(source.slice(0, stringIndex), "utf8");
}
export function sourceRange(source: string, startIndex: number, endIndex: number): string {
  return source.slice(treeIndexToStringIndex(source, startIndex), treeIndexToStringIndex(source, endIndex));
}
function countErrors(node: Node): number { let count = node.type === "ERROR" || node.isMissing ? 1 : 0; for (const child of node.namedChildren) if (child) count += countErrors(child); return count; }
async function parser(): Promise<Parser> { parserPromise ??= createParser(); return parserPromise; }
export async function parseSource(path: string, source: string, previous?: { tree: Tree; edit?: Edit }): Promise<ParsedFile> {
  const activeParser = await parser();
  const bytes = Buffer.from(source, "utf8");
  if (previous?.edit) previous.tree.edit(previous.edit);
  const tree = previous?.edit ? activeParser.parse(source, previous.tree) : activeParser.parse(source);
  if (!tree) throw new Error("Tree-sitter returned no tree");
  return { path, source, bytes, hash: hash(bytes), tree, syntaxErrors: countErrors(tree.rootNode) };
}
export async function parseFile(path: string): Promise<ParsedFile> {
  const bytes = await readFile(path);
  const fileHash = hash(bytes);
  const cached = cache.get(path);
  if (cached?.hash === fileHash) return cached;
  const parsed = await parseSource(path, bytes.toString("utf8"));
  cache.set(path, parsed);
  return parsed;
}
export function cacheFile(file: ParsedFile): void { cache.set(file.path, file); }
export function clearFileCache(path?: string): void { if (path) cache.delete(path); else cache.clear(); }
export function sourceOf(file: ParsedFile, node: Node): string { return sourceRange(file.source, node.startIndex, node.endIndex); }
export function lineAt(source: string, row: number): string { const lines = source.split(/\r?\n/); return lines[row] ?? ""; }
export function lineHash(source: string, row: number): string { return hash(lineAt(source, row)); }
