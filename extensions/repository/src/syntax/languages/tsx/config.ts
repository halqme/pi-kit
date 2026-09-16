import type { LanguageAdapter } from "../../language-profile.ts";
import { typescriptAdapter } from "../typescript/config.ts";

export const adapter: LanguageAdapter = {
  ...typescriptAdapter,
  id: "tsx",
  extensions: [".tsx"],
  grammar: {
    ...typescriptAdapter.grammar,
    id: "@repomix/tree-sitter-wasms@0.1.17/tsx",
    wasmFile: "out/tree-sitter-tsx.wasm",
  },
  lspLanguageId: "typescriptreact",
};

export const tsxAdapter = adapter;
