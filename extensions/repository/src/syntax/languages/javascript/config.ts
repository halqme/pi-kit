import { labelsQuery, outlineQuery, searchQueries } from "./queries.ts";
import type { LanguageAdapter } from "../../language-profile.ts";
export const adapter: LanguageAdapter = {
  id: "javascript",
  extensions: [".js", ".mjs", ".cjs"],
  grammar: {
    id: "tree-sitter-javascript@0.25.0",
    packageName: "tree-sitter-javascript",
    wasmFile: "tree-sitter-javascript.wasm",
  },
  lsp: { servers: [{ command: "typescript-language-server", args: ["--stdio"] }] },
  outlineQuery,
  labelsQuery,
  searchQueries,
  declarationNodeTypes: new Set(["class_declaration", "function_declaration", "method_definition"]),
  importantNodeTypes: new Set([
    "class_declaration",
    "function_declaration",
    "method_definition",
    "import_statement",
    "export_statement",
  ]),
};

export const javascriptAdapter = adapter;
