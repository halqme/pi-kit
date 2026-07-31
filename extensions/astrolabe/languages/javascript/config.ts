import { labelsQuery, outlineQuery } from "./queries.ts";
import type { LanguageAdapter } from "../../src/language-profile.ts";
export const javascriptAdapter: LanguageAdapter = {
  id: "javascript",
  extensions: [".js", ".mjs", ".cjs"],
  grammar: {
    id: "tree-sitter-javascript@0.25.0",
    packageName: "tree-sitter-javascript",
    wasmFile: "tree-sitter-javascript.wasm",
  },
  outlineQuery,
  labelsQuery,
  searchQueries: {
    function: `(function_declaration) @result (method_definition) @result`,
    call: `(call_expression function: (_) @callee) @result`,
    import: `(import_statement source: (string) @source) @result`,
  },
  declarationNodeTypes: new Set(["class_declaration", "function_declaration", "method_definition"]),
  importantNodeTypes: new Set([
    "class_declaration",
    "function_declaration",
    "method_definition",
    "import_statement",
    "export_statement",
  ]),
};
