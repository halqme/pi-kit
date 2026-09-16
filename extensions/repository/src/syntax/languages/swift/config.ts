import { labelsQuery, outlineQuery, searchQueries } from "./queries.ts";
import type { LanguageAdapter } from "../../language-profile.ts";

const declarationNodeTypes = new Set([
  "function_declaration",
  "protocol_function_declaration",
  "class_declaration",
  "protocol_declaration",
  "typealias_declaration",
  "import_declaration",
]);

export const adapter: LanguageAdapter = {
  id: "swift",
  extensions: [".swift"],
  grammar: {
    id: "@repomix/tree-sitter-wasms@0.1.17/swift",
    packageName: "@repomix/tree-sitter-wasms",
    wasmFile: "out/tree-sitter-swift.wasm",
  },
  lsp: { servers: [{ command: "sourcekit-lsp" }] },
  lspLanguageId: "swift",
  outlineQuery,
  labelsQuery,
  searchQueries,
  declarationNodeTypes,
  importantNodeTypes: declarationNodeTypes,
};

export const swiftAdapter = adapter;
