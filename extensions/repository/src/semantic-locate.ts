import { fileURLToPath } from "node:url";
import {
  adapterForLanguage,
  adapterForPath,
  adapterSupportsPath,
  type LanguageAdapter,
} from "./language-profile.ts";
import {
  declarationAtIndex,
  locateDetailed,
  locateMatchForDeclaration,
  type LocateMatch,
  type LocateParams,
} from "./locate.ts";
import type { LspService, LspSymbol } from "./lsp.ts";
import { HandleStore } from "./node-handles.ts";
import { isStringBoundary, parseFile } from "./parser.ts";
import {
  pathIsWithin,
  resolveExistingPath,
  resolveExistingScope,
  sourceFilesInScope,
} from "./path.ts";

function positionToStringIndex(
  source: string,
  position: { line: number; character: number },
): number | undefined {
  let line = 0;
  let start = 0;
  while (line < position.line) {
    const newline = source.indexOf("\n", start);
    if (newline < 0) return undefined;
    start = newline + 1;
    line++;
  }
  const newline = source.indexOf("\n", start);
  let lineEnd = newline < 0 ? source.length : newline;
  if (lineEnd > start && source.charCodeAt(lineEnd - 1) === 13) lineEnd--;
  const index = start + position.character;
  if (index < start || index > lineEnd || !isStringBoundary(source, index)) return undefined;
  return index;
}

function symbolScore(query: string, symbol: LspSymbol): number {
  const normalizedQuery = query.toLocaleLowerCase();
  const shortQuery = normalizedQuery.split(/[.#]/).at(-1) ?? normalizedQuery;
  const name = symbol.name.toLocaleLowerCase();
  const qualified = symbol.containerName
    ? `${symbol.containerName}.${symbol.name}`.toLocaleLowerCase()
    : name;
  if (qualified === normalizedQuery) return 160;
  if (name === normalizedQuery) return 150;
  if (name === shortQuery && qualified.endsWith(`.${normalizedQuery}`)) return 145;
  if (name === shortQuery) return 140;
  if (qualified.includes(normalizedQuery)) return 120;
  return 100;
}

function queryForSymbol(symbol: string): string {
  return symbol.split(/[.#]/).at(-1) ?? symbol;
}

function mergeMatches(
  structural: LocateMatch[],
  semantic: LocateMatch[],
  handles: HandleStore,
): LocateMatch[] {
  const merged = new Map<string, LocateMatch>();
  for (const match of [...structural, ...semantic]) {
    const key = `${match.path}\0${match.handle.startIndex}\0${match.handle.endIndex}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, match);
      continue;
    }

    // Independent evidence sources corroborating the same concrete syntax node
    // increase confidence. Repeated copies of the same evidence do not.
    const existingReasons = new Set(existing.reasons);
    const novelReasons = match.reasons.filter((reason) => !existingReasons.has(reason));
    if (novelReasons.length > 0) {
      const evidenceFraction =
        match.reasons.length === 0 ? 0 : novelReasons.length / match.reasons.length;
      existing.score += Math.round(match.score * evidenceFraction);
      existing.reasons = [...existing.reasons, ...novelReasons];
    }
    handles.delete(match.handle.id);
  }
  return [...merged.values()].sort(
    (left, right) =>
      right.score - left.score ||
      left.path.localeCompare(right.path) ||
      left.handle.startPosition.row - right.handle.startPosition.row,
  );
}

async function adaptersToQuery(params: LocateParams, cwd: string): Promise<LanguageAdapter[]> {
  if (params.language) {
    const adapter = adapterForLanguage(params.language);
    return adapter.lsp ? [adapter] : [];
  }
  const paths = await sourceFilesInScope(cwd, params.scope, (path) =>
    Boolean(adapterForPath(path)),
  );
  const ids = new Set<string>();
  for (const path of paths) {
    const adapter = adapterForPath(path);
    if (adapter?.lsp) ids.add(adapter.id);
  }
  return [...ids].map((id) => adapterForLanguage(id));
}

function inScope(scope: Awaited<ReturnType<typeof resolveExistingScope>>, path: string): boolean {
  return scope.kind === "file" ? path === scope.path : pathIsWithin(scope.path, path);
}

async function semanticMatches(
  params: LocateParams,
  cwd: string,
  handles: HandleStore,
  lsp: LspService,
): Promise<LocateMatch[]> {
  const symbols = params.symbols ?? [];
  if (symbols.length === 0) return [];

  const [scope, adapters] = await Promise.all([
    resolveExistingScope(cwd, params.scope),
    adaptersToQuery(params, cwd),
  ]);
  if (adapters.length === 0) return [];

  const requests = adapters.flatMap((adapter) =>
    symbols.map(async (requested) => ({
      adapter,
      requested,
      results: await lsp.workspaceSymbols(adapter, cwd, queryForSymbol(requested)),
    })),
  );
  const responses = await Promise.all(requests);
  const matches: LocateMatch[] = [];

  for (const { adapter, requested, results } of responses) {
    for (const symbol of results) {
      if (!symbol.uri.startsWith("file:")) continue;
      let path: string;
      try {
        path = await resolveExistingPath(cwd, fileURLToPath(symbol.uri));
      } catch {
        continue;
      }
      if (!inScope(scope, path)) continue;
      const actualAdapter = params.language
        ? scope.kind === "file"
          ? adapterForPath(path, params.language)
          : adapterSupportsPath(adapter, path)
            ? adapter
            : undefined
        : adapterForPath(path);
      if (!actualAdapter || actualAdapter.id !== adapter.id) continue;
      const file = await parseFile(path, actualAdapter);
      const index = positionToStringIndex(file.source, symbol.range.start);
      if (index === undefined) continue;
      const declaration = declarationAtIndex(file, actualAdapter, index);
      if (!declaration) continue;
      matches.push(
        locateMatchForDeclaration(
          file,
          declaration,
          actualAdapter,
          handles,
          symbolScore(requested, symbol),
          [`lsp:workspaceSymbol:${requested}`],
        ),
      );
    }
  }
  return matches;
}

export async function locateResolvedDetailed(
  params: LocateParams,
  cwd: string,
  handles: HandleStore,
  lsp: LspService,
): Promise<LocateMatch[]> {
  const [structural, semantic] = await Promise.all([
    locateDetailed(params, cwd, handles),
    semanticMatches(params, cwd, handles, lsp),
  ]);
  return mergeMatches(structural, semantic, handles);
}
