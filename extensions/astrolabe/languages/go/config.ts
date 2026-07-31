import { labelsQuery, outlineQuery } from "./queries.ts";
import type { LanguageAdapter } from "../../src/language-profile.ts";
export const goAdapter: LanguageAdapter = {
  id: "go",
  extensions: [".go"],
  grammar: {
    id: "tree-sitter-go@0.25.0",
    packageName: "tree-sitter-go",
    wasmFile: "tree-sitter-go.wasm",
  },
  outlineQuery,
  labelsQuery,
  searchQueries: {
    function: `[(function_declaration) (method_declaration)] @result`,
    call: `(call_expression function: (_) @callee) @result`,
    import: `(import_declaration) @result`,
  },
  declarationNodeTypes: new Set(["function_declaration", "method_declaration", "type_declaration"]),
  importantNodeTypes: new Set([
    "function_declaration",
    "method_declaration",
    "type_declaration",
    "import_declaration",
  ]),
};
