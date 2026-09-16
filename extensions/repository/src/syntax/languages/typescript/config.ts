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

export const adapter: LanguageAdapter = {
  id: "typescript",
  extensions: [".ts", ".mts", ".cts"],
  grammar: {
    id: "@repomix/tree-sitter-wasms@0.1.17/typescript",
    packageName: "@repomix/tree-sitter-wasms",
    wasmFile: "out/tree-sitter-typescript.wasm",
  },
  lsp: { servers: [{ command: "typescript-language-server", args: ["--stdio"] }] },
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

export const typescriptAdapter = adapter;
