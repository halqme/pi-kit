import { readdirSync } from "node:fs";
import { extname } from "node:path";

export type LanguageId = string;

export interface GrammarDescriptor {
  id: string;
  packageName: string;
  wasmFile: string;
}

export interface LspServerSpec {
  command: string;
  args?: readonly string[];
}

export interface LspProfile {
  servers: readonly LspServerSpec[];
}

export type SyntaxSearchKind = "function" | "call" | "import";

export interface LanguageAdapter {
  id: string;
  extensions: readonly string[];
  grammar: GrammarDescriptor;
  lsp?: LspProfile;
  outlineQuery: string;
  labelsQuery: string;
  searchQueries: Record<SyntaxSearchKind, string>;
  declarationNodeTypes: ReadonlySet<string>;
  importantNodeTypes: ReadonlySet<string>;
}

const languageDirectories = readdirSync(new URL("../languages/", import.meta.url), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const adapters: readonly LanguageAdapter[] = await Promise.all(
  languageDirectories.map(async (language) => {
    const module = (await import(`../languages/${language}/config.ts`)) as {
      adapter?: LanguageAdapter;
    };
    if (!module.adapter) {
      throw new Error(`Invalid language adapter: ${language}/config.ts must export adapter.`);
    }
    return module.adapter;
  }),
);
const adaptersById = new Map(adapters.map((adapter) => [adapter.id, adapter]));
export const supportedLanguageIds = adapters.map((adapter) => adapter.id) as [string, ...string[]];
export const supportedLanguageDescription = supportedLanguageIds.join(", ");
const explicitlyUnsupportedExtensions = new Set([".tsx"]);

export function adapterForLanguage(language: LanguageId): LanguageAdapter {
  const adapter = adaptersById.get(language);
  if (!adapter) throw new Error(`unsupported_language: Unknown language override: ${language}`);
  return adapter;
}

export function adapterForIdentity(
  languageId: string,
  grammarId: string,
): LanguageAdapter | undefined {
  const adapter = adaptersById.get(languageId as LanguageId);
  return adapter?.grammar.id === grammarId ? adapter : undefined;
}

export function adapterForPath(path: string, language?: LanguageId): LanguageAdapter | undefined {
  const extension = extname(path).toLowerCase();
  if (explicitlyUnsupportedExtensions.has(extension)) return undefined;
  if (language) return adaptersById.get(language);
  return adapters.find((adapter) => adapter.extensions.includes(extension));
}

export function requireAdapterForPath(path: string, language?: LanguageId): LanguageAdapter {
  const adapter = adapterForPath(path, language);
  if (!adapter) {
    throw new Error(
      language
        ? `unsupported_language: Unknown language override: ${language}`
        : `unsupported_language: Astrolabe supports ${supportedLanguageDescription} files.`,
    );
  }
  return adapter;
}
