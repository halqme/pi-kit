import { extname } from "node:path";
import { adapter as denoAdapter } from "../languages/deno/config.ts";
import { adapter as goAdapter } from "../languages/go/config.ts";
import { adapter as javascriptAdapter } from "../languages/javascript/config.ts";
import { adapter as pythonAdapter } from "../languages/python/config.ts";
import { adapter as typescriptAdapter } from "../languages/typescript/config.ts";

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
  initializationOptions?: unknown;
}

export type SyntaxSearchKind = "function" | "call" | "import";

export interface LanguageAdapter {
  id: string;
  extensions: readonly string[];
  autoDetect?: boolean;
  grammar: GrammarDescriptor;
  lsp?: LspProfile;
  lspLanguageId?: string;
  outlineQuery: string;
  labelsQuery: string;
  searchQueries: Record<SyntaxSearchKind, string>;
  declarationNodeTypes: ReadonlySet<string>;
  importantNodeTypes: ReadonlySet<string>;
}

const adapters: readonly LanguageAdapter[] = [
  denoAdapter,
  goAdapter,
  javascriptAdapter,
  pythonAdapter,
  typescriptAdapter,
];
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
  return adapters.find(
    (adapter) => adapter.autoDetect !== false && adapter.extensions.includes(extension),
  );
}

export function adapterSupportsPath(adapter: LanguageAdapter, path: string): boolean {
  return adapter.extensions.includes(extname(path).toLowerCase());
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
