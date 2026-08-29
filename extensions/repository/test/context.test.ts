import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import installLexicalEngine from "../src/context/lexical.ts";
import { rankDocuments, tokenize } from "../src/context/bm25.ts";

function engineTool(): any {
  let tool: any;
  installLexicalEngine({
    registerTool(value: unknown) {
      tool = value;
    },
  } as any);
  return tool;
}

test("lexical ranking handles rare terms and CJK tokens", () => {
  const tokens = tokenize("日本語検索 Unicode");
  assert.ok(tokens.includes("日本語検索"));
  assert.ok(tokens.includes("日本"));
  assert.ok(tokens.includes("unicode"));
  const hits = rankDocuments(
    [
      { id: "generic", text: "generic repository tools" },
      { id: "relevant", text: "retrieval for 日本語検索 and rare-widget" },
    ],
    "日本語検索 rare-widget",
  );
  assert.equal(hits[0]?.id, "relevant");
});

test("lexical engine scans text while excluding repository hazards", async () => {
  const root = await mkdtemp(join(tmpdir(), "repository-context-"));
  try {
    await mkdir(join(root, "docs"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "docs", "hit.md"), "rare-widget repository retrieval\n");
    await writeFile(join(root, "node_modules", "pkg", "ignored.md"), "rare-widget\n");
    await writeFile(join(root, ".env"), "rare-widget secret\n");
    const response = await engineTool().execute(
      "call",
      { query: "rare-widget" },
      new AbortController().signal,
      undefined,
      { cwd: root },
    );
    const details = response.details as {
      results: Array<{ path: string }>;
      stats: { skippedSecret: number };
    };
    assert.equal(details.results[0]?.path, "docs/hit.md");
    assert.ok(details.stats.skippedSecret >= 1);
    assert.equal(
      details.results.some((item) => item.path.includes("node_modules")),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
