import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { syntaxSearchDetailed } from "../../src/context/syntax-search.ts";
import {
  adapterForLanguage,
  adapterForPath,
  supportedLanguageIds,
} from "../../src/syntax/language-profile.ts";
import { HandleStore } from "../../src/syntax/node-handles.ts";
import { clearFileCache, parseSource } from "../../src/syntax/parser.ts";
import { outline } from "../../src/syntax/render.ts";

test("registers Vue as an auto-detected repository language", () => {
  assert.equal(adapterForPath("src/App.vue")?.id, "vue");
  assert.deepEqual(adapterForLanguage("vue").lsp?.servers[0], {
    command: "vue-language-server",
    args: ["--stdio"],
  });
  assert.ok(supportedLanguageIds.includes("vue"));
});

test("parses Vue SFC structure without pretending raw script text is a syntax tree", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-vue-"));
  const path = join(dir, "App.vue");
  const source = `<script setup lang="ts">
import { computed, ref } from "vue"
const count = ref(0)
const doubled = computed(() => count.value * 2)
</script>

<template>
  <button @click="count++">{{ doubled }}</button>
</template>

<style scoped>
button { font-weight: 600; }
</style>
`;
  await writeFile(path, source);
  const adapter = adapterForLanguage("vue");
  const file = await parseSource(path, source, { adapter });
  const handles = new HandleStore();
  const rendered = outline(file, file.tree.rootNode, handles, 2);

  assert.equal(file.languageId, "vue");
  assert.equal(file.syntaxErrors, 0);
  assert.match(rendered, /<script>/);
  assert.match(rendered, /<template>/);
  assert.match(rendered, /<style>/);
  assert.deepEqual(await syntaxSearchDetailed({ path, kind: "function" }, dir, handles), []);
  clearFileCache(path);
});
