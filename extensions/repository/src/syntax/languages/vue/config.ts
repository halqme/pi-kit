import { labelsQuery, outlineQuery, searchQueries } from "./queries.ts";
import type { LanguageAdapter } from "../../language-profile.ts";

const sectionNodeTypes = new Set(["template_element", "script_element", "style_element"]);

export const adapter: LanguageAdapter = {
  id: "vue",
  extensions: [".vue"],
  grammar: {
    id: "@repomix/tree-sitter-wasms@0.1.17/vue",
    packageName: "@repomix/tree-sitter-wasms",
    wasmFile: "out/tree-sitter-vue.wasm",
  },
  lsp: { servers: [{ command: "vue-language-server", args: ["--stdio"] }] },
  lspLanguageId: "vue",
  outlineQuery,
  labelsQuery,
  searchQueries,
  declarationNodeTypes: sectionNodeTypes,
  importantNodeTypes: new Set([...sectionNodeTypes, "interpolation", "directive_attribute"]),
};

export const vueAdapter = adapter;
