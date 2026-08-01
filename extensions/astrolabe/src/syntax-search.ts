import { Query, type Node } from "web-tree-sitter";
import {
  adapterForLanguage,
  adapterForPath,
  requireAdapterForPath,
  type LanguageId,
} from "./language-profile.ts";
import { HandleStore, type NodeHandle } from "./node-handles.ts";
import { parseFile, sourceOf, type ParsedFile } from "./parser.ts";
import { sourceFilesInScope } from "./path.ts";

export type SyntaxSearchKind = "function" | "call" | "import";

export interface SyntaxSearchParams {
  /** @deprecated Use scope. Kept temporarily for internal callers during the API migration. */
  path?: string;
  scope?: string;
  kind: SyntaxSearchKind;
  name?: string;
  source?: string;
  language?: LanguageId;
}

interface SearchMatch {
  node: Node;
  name: string;
  source?: string;
}

export interface SyntaxSearchMatch {
  handle: NodeHandle;
  path: string;
  name: string;
  source?: string;
  description: string;
}

function nodeText(file: ParsedFile, node: Node | null): string {
  return node ? sourceOf(file, node).replace(/\s+/g, " ").trim() : "";
}

function importSource(file: ParsedFile, node: Node): string {
  return nodeText(file, node.childForFieldName("source")).replace(/^['"]|['"]$/g, "");
}

function matchName(file: ParsedFile, node: Node): string {
  if (node.type === "import_statement") {
    return importSource(file, node);
  }
  const name = node.childForFieldName("name");
  if (name) return nodeText(file, name);
  const callee = node.childForFieldName("function");
  if (callee) {
    const property = callee.childForFieldName("property");
    return nodeText(file, property ?? callee);
  }
  return "";
}

function matchesFilter(match: SearchMatch, params: SyntaxSearchParams): boolean {
  if (params.name !== undefined && match.name !== params.name) return false;
  if (params.source !== undefined && match.source !== params.source) return false;
  return true;
}

function collectMatches(
  file: ParsedFile,
  params: SyntaxSearchParams,
  adapter: ReturnType<typeof requireAdapterForPath>,
): SearchMatch[] {
  let query: Query | undefined;
  try {
    query = new Query(file.tree.language, adapter.searchQueries[params.kind]);
    const matches = new Map<number, SearchMatch>();
    for (const capture of query.captures(file.tree.rootNode)) {
      if (capture.name === "result") {
        const source = params.kind === "import" ? importSource(file, capture.node) : undefined;
        const match = {
          node: capture.node,
          name: matchName(file, capture.node),
          ...(source ? { source } : {}),
        };
        matches.set(capture.node.id, match);
      }
    }
    return [...matches.values()].filter((match) => matchesFilter(match, params));
  } catch (error) {
    throw new Error(`syntax_search_query_error: ${String(error)}`);
  } finally {
    query?.delete();
  }
}

function describeMatch(file: ParsedFile, match: SearchMatch): string {
  const start = match.node.startPosition;
  const end = match.node.endPosition;
  const label = match.name || match.node.type;
  return `${label} (${match.node.type}, ${start.row + 1}:${start.column + 1}-${end.row + 1}:${end.column + 1}) ${nodeText(file, match.node)}`;
}

function requestedScope(params: SyntaxSearchParams): string {
  const scope = params.scope ?? params.path;
  if (!scope) throw new Error("search requires a file or directory scope");
  return scope;
}

export async function syntaxSearchDetailed(
  params: SyntaxSearchParams,
  cwd: string,
  handles: HandleStore,
): Promise<SyntaxSearchMatch[]> {
  const paths = await sourceFilesInScope(cwd, requestedScope(params), (path) =>
    Boolean(adapterForPath(path)),
  );
  const matches: SyntaxSearchMatch[] = [];
  for (const path of paths) {
    const adapter = params.language
      ? adapterForLanguage(params.language)
      : requireAdapterForPath(path);
    const file = await parseFile(path, adapter);
    for (const match of collectMatches(file, params, adapter)) {
      const handle = handles.issue(file, match.node, "outline");
      matches.push({
        handle,
        path,
        name: match.name,
        ...(match.source ? { source: match.source } : {}),
        description: describeMatch(file, match),
      });
    }
  }
  return matches;
}

export async function syntaxSearch(
  params: SyntaxSearchParams,
  cwd: string,
  handles: HandleStore,
): Promise<string> {
  const matches = await syntaxSearchDetailed(params, cwd, handles);
  if (matches.length === 0) return "(no syntax matches)";
  return matches.map((match) => `nodeId=${match.handle.id} ${match.description}`).join("\n");
}
