import { labelsQuery, outlineQuery } from "./queries.ts";
import type { LanguageAdapter } from "../../src/language-profile.ts";
export const pythonAdapter: LanguageAdapter = {
  id: "python",
  extensions: [".py", ".pyw"],
  grammar: {
    id: "tree-sitter-python@0.25.0",
    packageName: "tree-sitter-python",
    wasmFile: "tree-sitter-python.wasm",
  },
  outlineQuery,
  labelsQuery,
  searchQueries: {
    function: `(function_definition) @result`,
    call: `(call function: (_) @callee) @result`,
    import: `[(import_statement) (import_from_statement)] @result`,
  },
  declarationNodeTypes: new Set(["class_definition", "function_definition"]),
  importantNodeTypes: new Set([
    "class_definition",
    "function_definition",
    "import_statement",
    "import_from_statement",
  ]),
};
