import { labelsQuery, outlineQuery, searchQueries } from "./queries.ts";
import type { LanguageAdapter } from "../../language-profile.ts";

const importantNodeTypes = new Set([
  "class_declaration",
  "function_declaration",
  "method_definition",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "import_statement",
  "export_statement",
]);

const grammarPackage = "tree-sitter-typescript";

export const adapter: LanguageAdapter = {
  id: "deno",
  extensions: [".ts", ".mts", ".cts"],
  autoDetect: false,
  grammar: {
    id: "tree-sitter-typescript@0.23.2/typescript",
    packageName: grammarPackage,
    wasmFile: "tree-sitter-typescript.wasm",
  },
  lsp: {
    servers: [{ command: "deno", args: ["lsp"] }],
    initializationOptions: { enable: true },
  },
  lspLanguageId: "typescript",
  outlineQuery,
  labelsQuery,
  searchQueries,
  declarationNodeTypes: new Set([
    "class_declaration",
    "function_declaration",
    "generator_function_declaration",
    "interface_declaration",
    "method_definition",
    "type_alias_declaration",
    "enum_declaration",
  ]),
  importantNodeTypes,
};

export const denoAdapter = adapter;
