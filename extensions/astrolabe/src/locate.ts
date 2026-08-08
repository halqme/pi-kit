import type { Node } from "web-tree-sitter";
import { requireAdapterForPath, type LanguageAdapter } from "./language-profile.ts";
import { HandleStore, type NodeHandle } from "./node-handles.ts";
import { parseFile, sourceOf, type ParsedFile } from "./parser.ts";
import { sourceFilesInScope } from "./path.ts";

export interface LocateParams {
  scope: string;
  symbols?: string[];
  terms?: string[];
  maxCandidates?: number;
}

export interface LocateFlow {
  awaits: number;
  branches: number;
  calls: string[];
  returns: number;
  throws: number;
}

export interface LocateMatch {
  handle: NodeHandle;
  path: string;
  name: string;
  parent?: string;
  signature: string;
  flow: LocateFlow;
  score: number;
  reasons: string[];
  source: string;
}

function declarationName(file: ParsedFile, node: Node): string {
  return sourceOf(file, node.childForFieldName("name") ?? node).split(/\s|\(/, 1)[0] ?? node.type;
}

function qualifiedName(
  file: ParsedFile,
  node: Node,
  name: string,
  adapter: LanguageAdapter,
): string {
  const parts = [name];
  let current = node.parent;
  while (current) {
    if (adapter.declarationNodeTypes.has(current.type)) {
      const parentName = declarationName(file, current);
      if (parentName) parts.unshift(parentName);
    }
    current = current.parent;
  }
  return parts.join(".");
}

function signature(file: ParsedFile, node: Node): string {
  const body = node.childForFieldName("body");
  return sourceOf(file, node)
    .slice(0, body ? body.startIndex - node.startIndex : undefined)
    .replace(/\s*[{;]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parentName(file: ParsedFile, node: Node, adapter: LanguageAdapter): string | undefined {
  let current = node.parent;
  while (current) {
    if (adapter.declarationNodeTypes.has(current.type)) return declarationName(file, current);
    current = current.parent;
  }
  return undefined;
}

function containsCall(node: Node): boolean {
  for (const child of node.namedChildren) {
    if (!child) continue;
    if (child.type === "call_expression" || child.type === "call" || containsCall(child))
      return true;
  }
  return false;
}

function flow(file: ParsedFile, node: Node): LocateFlow {
  const calls = new Set<string>();
  let awaits = 0;
  let branches = 0;
  let returns = 0;
  let throws = 0;
  const visit = (current: Node): void => {
    if (current.type === "call_expression" || current.type === "call") {
      const callee = current.childForFieldName("function") ?? current.childForFieldName("callee");
      if (callee && !containsCall(callee) && calls.size < 8) {
        calls.add(sourceOf(file, callee).replace(/\s+/g, " "));
      }
    }
    if (["if_statement", "switch_statement", "conditional_expression"].includes(current.type))
      branches++;
    if (current.type === "return_statement") returns++;
    if (["throw_statement", "raise_statement"].includes(current.type)) throws++;
    if (["await_expression", "await"].includes(current.type)) awaits++;
    for (const child of current.namedChildren) if (child) visit(child);
  };
  visit(node);
  return { awaits, branches, calls: [...calls], returns, throws };
}

function scoreCandidate(
  source: string,
  name: string,
  qualified: string,
  symbols: readonly string[],
  terms: readonly string[],
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  for (const symbol of symbols) {
    if (symbol === qualified) {
      score += 100;
      reasons.push(`tree-sitter:symbol:${symbol}:qualified`);
    } else if (symbol === name) {
      score += 90;
      reasons.push(`tree-sitter:symbol:${symbol}:name`);
    }
  }
  const normalized = source.toLocaleLowerCase();
  for (const term of terms) {
    if (normalized.includes(term.toLocaleLowerCase())) {
      score += 10;
      reasons.push(`text:term:${term}`);
    }
  }
  return { score, reasons };
}

export function locateMatchForDeclaration(
  file: ParsedFile,
  node: Node,
  adapter: LanguageAdapter,
  handles: HandleStore,
  score: number,
  reasons: string[],
): LocateMatch {
  const name = declarationName(file, node);
  const parent = parentName(file, node, adapter);
  return {
    handle: handles.issue(file, node, "structure"),
    path: file.path,
    name,
    ...(parent ? { parent } : {}),
    signature: signature(file, node),
    flow: flow(file, node),
    score,
    reasons,
    source: sourceOf(file, node),
  };
}

export function declarationAtIndex(
  file: ParsedFile,
  adapter: LanguageAdapter,
  index: number,
): Node | undefined {
  if (!Number.isInteger(index) || index < 0 || index > file.source.length) return undefined;
  let current: Node | null = file.tree.rootNode.descendantForIndex(index, index);
  while (current) {
    if (adapter.declarationNodeTypes.has(current.type)) return current;
    current = current.parent;
  }
  return undefined;
}

export async function locateDetailed(
  params: LocateParams,
  cwd: string,
  handles: HandleStore,
): Promise<LocateMatch[]> {
  const symbols = params.symbols ?? [];
  const terms = params.terms ?? [];
  const paths = await sourceFilesInScope(cwd, params.scope, (path) => {
    try {
      requireAdapterForPath(path);
      return true;
    } catch {
      return false;
    }
  });
  const matches: LocateMatch[] = [];

  for (const path of paths) {
    const adapter = requireAdapterForPath(path);
    const file = await parseFile(path, adapter);
    const visit = (node: Node): void => {
      if (adapter.declarationNodeTypes.has(node.type)) {
        const name = declarationName(file, node);
        const candidateSource = sourceOf(file, node);
        const { score, reasons } = scoreCandidate(
          candidateSource,
          name,
          qualifiedName(file, node, name, adapter),
          symbols,
          terms,
        );
        if (score > 0) {
          matches.push(locateMatchForDeclaration(file, node, adapter, handles, score, reasons));
        }
      }
      for (const child of node.namedChildren) if (child) visit(child);
    };
    visit(file.tree.rootNode);
  }

  return matches.sort(
    (left, right) =>
      right.score - left.score ||
      left.path.localeCompare(right.path) ||
      left.handle.startPosition.row - right.handle.startPosition.row,
  );
}
