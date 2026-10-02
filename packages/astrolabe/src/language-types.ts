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
  searchQueries: Partial<Record<SyntaxSearchKind, string>>;
  declarationNodeTypes: ReadonlySet<string>;
  importantNodeTypes: ReadonlySet<string>;
}
