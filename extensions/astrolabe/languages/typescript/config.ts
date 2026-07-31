import { labelsQuery, outlineQuery, searchQueries } from "./queries.ts";
import type { LanguageAdapter } from "../../src/language-profile.ts";

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

export const typescriptAdapter: LanguageAdapter = {
  id: "typescript",
  extensions: [".ts", ".mts", ".cts"],
  grammar: {
    id: "tree-sitter-typescript@0.23.2/typescript",
    packageName: grammarPackage,
    wasmFile: "tree-sitter-typescript.wasm",
  },
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
