import { labelsQuery, outlineQuery, searchQueries } from "./queries.ts";
import type { LanguageAdapter } from "../../language-profile.ts";
export const adapter: LanguageAdapter = {
  id: "go",
  extensions: [".go"],
  grammar: {
    id: "tree-sitter-go@0.25.0",
    packageName: "tree-sitter-go",
    wasmFile: "tree-sitter-go.wasm",
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
