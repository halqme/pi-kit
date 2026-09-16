import { labelsQuery, outlineQuery, searchQueries } from "./queries.ts";
import type { LanguageAdapter } from "../../language-profile.ts";
export const adapter: LanguageAdapter = {
  id: "python",
  extensions: [".py", ".pyw"],
  grammar: {
    id: "@repomix/tree-sitter-wasms@0.1.17/python",
    packageName: "@repomix/tree-sitter-wasms",
    wasmFile: "out/tree-sitter-python.wasm",
  },
  lsp: {
    servers: [
      { command: "basedpyright-langserver", args: ["--stdio"] },
      { command: "pyright-langserver", args: ["--stdio"] },
    ],
  },
  outlineQuery,
  labelsQuery,
  searchQueries,
  declarationNodeTypes: new Set(["class_definition", "function_definition"]),
  importantNodeTypes: new Set([
    "class_definition",
    "function_definition",
    "import_statement",
    "import_from_statement",
  ]),
};

export const pythonAdapter = adapter;
