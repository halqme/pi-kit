import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import extension from "./index.ts";
import { rankDocuments, tokenize } from "./bm25.ts";

function registeredTool(): any {
  let tool: any;
  extension({
    registerTool(value: unknown) {
      tool = value;
    },
  } as any);
  return tool;
}

async function withTempDirectory(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "bm25-search-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("BM25 ranks rare query terms and tokenizes Unicode and CJK bigrams", () => {
  const tokens = tokenize("日本語検索 Unicode");
  assert.ok(tokens.includes("日本語検索"));
  assert.ok(tokens.includes("日"));
  assert.ok(tokens.includes("日本"));
  assert.ok(tokens.includes("unicode"));

  const hits = rankDocuments(
    [
      { id: "generic.md", text: "This file discusses search and tools." },
      { id: "relevant.md", text: "BM25 retrieval improves 日本語検索 relevance." },
      { id: "long.md", text: `${"common ".repeat(200)} BM25 retrieval` },
    ],
    "BM25 日本語検索",
  );
  assert.equal(hits[0]?.id, "relevant.md");
  assert.ok((hits[0]?.matchedTerms ?? 0) >= 5);
  assert.ok((hits[0]?.score ?? 0) > (hits[1]?.score ?? 0));
});

test("empty or punctuation-only queries produce no ranked documents", () => {
  assert.deepEqual(rankDocuments([{ id: "one", text: "some text" }], "!!!"), []);
});

test("public tool scans the cwd, returns snippets, and excludes unsafe or generated inputs", async () => {
  await withTempDirectory(async (root) => {
    await mkdir(join(root, "docs"), { recursive: true });
    await mkdir(join(root, ".git"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(
      join(root, "docs", "relevant.md"),
      "A heading\nBM25 retrieval for 日本語検索\nKeep this context line.\n",
    );
    await writeFile(join(root, "docs", "generic.md"), "A generic note about tools.\n");
    await writeFile(join(root, ".git", "ignored.md"), "BM25 secret repository metadata\n");
    await writeFile(join(root, "node_modules", "pkg", "ignored.md"), "BM25 dependency\n");
    await writeFile(join(root, "dist", "ignored.md"), "BM25 generated output\n");
    await writeFile(join(root, ".env"), "BM25_TOKEN=do-not-return\n");
    await writeFile(join(root, "private.pem"), "BM25 private key\n");
    await writeFile(join(root, "binary.bin"), Buffer.from([0, 1, 2, 3]));

    const tool = registeredTool();
    const response = await tool.execute(
      "1",
      { query: "BM25 日本語検索" },
      new AbortController().signal,
      undefined,
      { cwd: root },
    );

    assert.notEqual(response.isError, true);
    assert.equal(response.details.results[0]?.path, "docs/relevant.md");
    assert.equal(response.details.stats.indexedFiles, 2);
    assert.ok(response.details.stats.skippedDirectories >= 3);
    assert.ok(response.details.stats.skippedSecret >= 2);
    assert.equal(response.details.stats.skippedBinary, 1);
    assert.match(response.details.results[0]?.snippets[0]?.text ?? "", /BM25 retrieval/);
    assert.doesNotMatch(response.content[0].text, /do-not-return/);

    const directGeneratedFile = await tool.execute(
      "2",
      { query: "generated output", path: "dist/ignored.md" },
      new AbortController().signal,
      undefined,
      { cwd: root },
    );
    assert.equal(directGeneratedFile.details.stats.indexedFiles, 0);
    assert.equal(directGeneratedFile.details.results.length, 0);
  });
});

test("public tool reports truncation and rejects empty or missing search targets", async () => {
  await withTempDirectory(async (root) => {
    await writeFile(join(root, "a.md"), "BM25 first\n");
    await writeFile(join(root, "b.md"), "BM25 second\n");
    await writeFile(join(root, "large.md"), `${"large-only ".repeat(20)}\n`);
    const tool = registeredTool();

    const truncated = await tool.execute(
      "1",
      { query: "BM25", maxFiles: 1 },
      new AbortController().signal,
      undefined,
      { cwd: root },
    );
    assert.notEqual(truncated.isError, true);
    assert.equal(truncated.details.stats.scannedFiles, 1);
    assert.equal(truncated.details.stats.truncated, true);
    assert.equal(truncated.details.results.length, 1);

    const sizeLimited = await tool.execute(
      "2",
      { query: "large-only", maxFileBytes: 32 },
      new AbortController().signal,
      undefined,
      { cwd: root },
    );
    assert.notEqual(sizeLimited.isError, true);
    assert.equal(sizeLimited.details.stats.skippedOversize, 1);
    assert.equal(sizeLimited.details.results.length, 0);

    await assert.rejects(
      () =>
        tool.execute("3", { query: "   " }, new AbortController().signal, undefined, { cwd: root }),
      /query must not be empty/,
    );

    await assert.rejects(
      () =>
        tool.execute(
          "4",
          { query: "BM25", path: "missing" },
          new AbortController().signal,
          undefined,
          { cwd: root },
        ),
      /Unable to access search path/,
    );
  });
});

test("file targets are searchable without walking their parent directory", async () => {
  await withTempDirectory(async (root) => {
    const file = join(root, "note.md");
    await writeFile(file, "BM25 file target\n");
    const tool = registeredTool();
    const response = await tool.execute(
      "1",
      { query: "file target", path: "note.md", contextLines: 0 },
      new AbortController().signal,
      undefined,
      { cwd: root },
    );
    assert.equal(response.details.stats.indexedFiles, 1);
    assert.equal(response.details.results[0]?.path, "note.md");
    assert.equal(response.details.results[0]?.snippets[0]?.startLine, 1);
  });
});
