import { labelsQuery, outlineQuery, searchQueries } from "./queries.ts";
import type { LanguageAdapter } from "../../language-profile.ts";
export const adapter: LanguageAdapter = {
  id: "go",
  extensions: [".go"],
  grammar: {
    id: "@repomix/tree-sitter-wasms@0.1.17/go",
    packageName: "@repomix/tree-sitter-wasms",
    wasmFile: "out/tree-sitter-go.wasm",
  },
  lsp: { servers: [{ command: "gopls" }] },
  outlineQuery,
  labelsQuery,
  searchQueries,
  declarationNodeTypes: new Set(["function_declaration", "method_declaration", "type_declaration"]),
  importantNodeTypes: new Set([
    "function_declaration",
    "method_declaration",
    "type_declaration",
    "import_declaration",
  ]),
};

export const goAdapter = adapter;
