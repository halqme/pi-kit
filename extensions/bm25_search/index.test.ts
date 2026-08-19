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

test("public tool exposes only the paths search-root API", () => {
  const tool = registeredTool();
  assert.ok(tool.parameters.properties.paths);
  assert.equal(tool.parameters.properties.path, undefined);
});

test("public tool scans the cwd, returns compact ranked snippets, and excludes unsafe inputs", async () => {
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
    await writeFile(join(root, ".git", "ignored.md"), "BM25 repository metadata\n");
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

    assert.equal(response.details.results[0]?.path, "docs/relevant.md");
    assert.equal(response.details.stats.indexedFiles, 2);
    assert.ok(response.details.stats.skippedDirectories >= 3);
    assert.ok(response.details.stats.skippedSecret >= 2);
    assert.equal(response.details.stats.skippedBinary, 1);
    assert.match(response.details.results[0]?.snippets[0]?.text ?? "", /BM25 retrieval/);
    assert.ok((response.details.results[0]?.snippets.length ?? 0) <= 2);
    assert.doesNotMatch(response.content[0].text, /do-not-return/);

    const directGeneratedFile = await tool.execute(
      "2",
      { query: "generated output", paths: ["dist/ignored.md"] },
      new AbortController().signal,
      undefined,
      { cwd: root },
    );
    assert.equal(directGeneratedFile.details.stats.indexedFiles, 0);
    assert.equal(directGeneratedFile.details.results.length, 0);
  });
});

test("passage ranking avoids penalizing a long file and snippet ranking favors the dense match", async () => {
  await withTempDirectory(async (root) => {
    const lines = Array.from({ length: 120 }, () => "const common = true;");
    lines[96] = "semantic retrieval behavior ranking dense match";
    lines[2] = "semantic";
    await writeFile(join(root, "long.ts"), `${lines.join("\n")}\n`);
    await writeFile(join(root, "short.ts"), "semantic note\n");

    const tool = registeredTool();
    const response = await tool.execute(
      "1",
      { query: "semantic retrieval behavior ranking" },
      new AbortController().signal,
      undefined,
      { cwd: root },
    );

    assert.equal(response.details.results[0]?.path, "long.ts");
    assert.match(response.details.results[0]?.snippets[0]?.text ?? "", /dense match/);
    assert.ok((response.details.results[0]?.snippets[0]?.startLine ?? 0) > 90);
  });
});

test("gitignore-style files are inherited and the cwd may itself live below an ignored-looking ancestor", async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, "build", "workspace");
    await mkdir(join(root, "nested", "kept"), { recursive: true });
    await mkdir(join(root, "nested", "ignored-dir"), { recursive: true });
    await writeFile(join(root, ".gitignore"), "ignored.txt\n/anchored.txt\nignored-dir/\n");
    await writeFile(join(root, ".agentsignore"), "agent-only.txt\n");
    await writeFile(join(root, "nested", ".ignore"), "local.txt\n");
    await writeFile(join(root, "kept.txt"), "retrieval target kept\n");
    await writeFile(join(root, "ignored.txt"), "retrieval target ignored\n");
    await writeFile(join(root, "anchored.txt"), "retrieval target ignored\n");
    await writeFile(join(root, "nested", "anchored.txt"), "retrieval target nested kept\n");
    await writeFile(join(root, "agent-only.txt"), "retrieval target ignored\n");
    await writeFile(join(root, "nested", "local.txt"), "retrieval target ignored\n");
    await writeFile(join(root, "nested", "ignored-dir", "x.txt"), "retrieval target ignored\n");
    await writeFile(join(root, "nested", "kept", "x.txt"), "retrieval target kept\n");

    const tool = registeredTool();
    const response = await tool.execute(
      "1",
      { query: "retrieval target", limit: 20 },
      new AbortController().signal,
      undefined,
      { cwd: root },
    );
    const paths = response.details.results.map((result: any) => result.path);

    assert.ok(paths.includes("kept.txt"));
    assert.ok(paths.includes("nested/anchored.txt"));
    assert.ok(paths.includes("nested/kept/x.txt"));
    assert.ok(!paths.includes("ignored.txt"));
    assert.ok(!paths.includes("anchored.txt"));
    assert.ok(!paths.includes("agent-only.txt"));
    assert.ok(!paths.includes("nested/local.txt"));
    assert.ok(!paths.includes("nested/ignored-dir/x.txt"));
    assert.ok(response.details.stats.skippedIgnored >= 5);
  });
});

test("multiple search roots share one ranking and overlapping roots do not duplicate files", async () => {
  await withTempDirectory(async (root) => {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(
      join(root, "src", "implementation.ts"),
      "conceptual cache invalidation behavior\n",
    );
    await writeFile(join(root, "docs", "guide.md"), "conceptual cache behavior\n");

    const tool = registeredTool();
    const response = await tool.execute(
      "1",
      { query: "conceptual cache invalidation behavior", paths: ["src", "docs", "src"] },
      new AbortController().signal,
      undefined,
      { cwd: root },
    );

    assert.deepEqual(response.details.roots, [join(root, "src"), join(root, "docs")]);
    assert.equal(response.details.stats.scannedFiles, 2);
    assert.equal(response.details.results[0]?.path, "src/implementation.ts");
    assert.equal(new Set(response.details.results.map((result: any) => result.path)).size, 2);
  });
});

test("file and total-byte limits are enforced without reading an unbounded corpus", async () => {
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
    assert.equal(sizeLimited.details.stats.skippedOversize, 1);
    assert.equal(sizeLimited.details.results.length, 0);

    const byteLimited = await tool.execute(
      "3",
      { query: "BM25", maxTotalBytes: 16 },
      new AbortController().signal,
      undefined,
      { cwd: root },
    );
    assert.equal(byteLimited.details.stats.truncated, true);
    assert.ok(byteLimited.details.stats.skippedBudget >= 1);
    assert.ok(byteLimited.details.stats.indexedBytes <= 16);
  });
});

test("invalid queries reject and missing targets do not hide successful roots", async () => {
  await withTempDirectory(async (root) => {
    const tool = registeredTool();
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(join(root, "tests", "example.test.ts"), "BM25 test target\n");

    await assert.rejects(
      () =>
        tool.execute("1", { query: "   " }, new AbortController().signal, undefined, { cwd: root }),
      /query must not be empty/,
    );

    const response = await tool.execute(
      "2",
      { query: "BM25", paths: ["tests", "spec"] },
      new AbortController().signal,
      undefined,
      { cwd: root },
    );
    assert.equal(response.details.results[0]?.path, "tests/example.test.ts");
    assert.equal(response.details.pathErrors.length, 1);
    assert.equal(response.details.pathErrors[0]?.path, join(root, "spec"));
    assert.match(response.details.pathErrors[0]?.message ?? "", /Unable to access search path/);
    assert.match(response.content[0]?.text ?? "", /Search path issues/);
    assert.match(response.content[0]?.text ?? "", /spec/);
  });
});

test("file targets are searchable without walking their parent directory", async () => {
  await withTempDirectory(async (root) => {
    const file = join(root, "note.md");
    await writeFile(file, "BM25 file target\n");
    const tool = registeredTool();
    const response = await tool.execute(
      "1",
      { query: "file target", paths: ["note.md"], contextLines: 0 },
      new AbortController().signal,
      undefined,
      { cwd: root },
    );
    assert.equal(response.details.stats.indexedFiles, 1);
    assert.equal(response.details.results[0]?.path, "note.md");
    assert.equal(response.details.results[0]?.snippets[0]?.startLine, 1);
  });
});
