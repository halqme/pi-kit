import { Query, type Node } from "web-tree-sitter";
import { adapterForLanguage, requireAdapterForPath, type LanguageId } from "./language-profile.ts";
import { parseFile, sourceOf, type ParsedFile } from "./parser.ts";
import { HandleStore } from "./node-handles.ts";
import { resolveExistingPath } from "./path.ts";

export type SyntaxSearchKind = "function" | "call" | "import";

export interface SyntaxSearchParams {
  path: string;
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

export async function syntaxSearch(
  params: SyntaxSearchParams,
  cwd: string,
  handles: HandleStore,
): Promise<string> {
  const path = await resolveExistingPath(cwd, params.path);
  const adapter = params.language
    ? adapterForLanguage(params.language)
    : requireAdapterForPath(path);
  const file = await parseFile(path, adapter);
  const matches = collectMatches(file, params, adapter);
  if (matches.length === 0) return "(no syntax matches)";
  return matches
    .map((match) => {
      const handle = handles.issue(file, match.node, "structure");
      return `nodeId=${handle.id} ${describeMatch(file, match)}`;
    })
    .join("\n");
}
