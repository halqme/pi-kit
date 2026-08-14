import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import astrolabe from "../index.ts";

interface CapturedTool {
  execute: (...args: unknown[]) => Promise<unknown>;
}

interface SyntaxResponse {
  ok: boolean;
  action: string;
  outline?: string;
  source?: string;
  message?: string;
  data?: {
    outline?: string;
    source?: string;
    matchCount?: number;
    candidateCount?: number;
    mode?: "source" | "cards" | "none";
    candidates?: Array<{
      continuation: { token: string };
      name: string;
      source?: string;
      signature: string;
      flow: { calls: string[]; branches: number; returns: number; throws: number; awaits: number };
      score: number;
    }>;
    sources?: Array<{
      continuation: { token: string };
      path: string;
      type: string;
      source: string;
    }>;
  };
  handles?: Array<{ continuation: { token: string }; capabilities: string[] }>;
  next?: Array<Record<string, unknown>>;
  error?: { code: string; message?: string };
}

interface ToolResult {
  content: Array<{ text: string }>;
  details: { metrics: unknown };
  isError?: boolean;
}

function result(value: unknown): ToolResult {
  return value as ToolResult;
}

function responseOf(toolResult: ToolResult): SyntaxResponse {
  return JSON.parse(toolResult.content[0]?.text ?? "{}");
}

function setup(_cwd: string): CapturedTool {
  const tools: CapturedTool[] = [];
  const pi = {
    registerTool(tool: CapturedTool) {
      tools.push(tool);
    },
    on() {},
  } as unknown as ExtensionAPI;
  astrolabe(pi);
  const tool = tools[0];
  assert.ok(tool);
  return tool;
}

async function call(
  tool: CapturedTool,
  cwd: string,
  request: Record<string, unknown>,
): Promise<ToolResult> {
  return result(
    await tool.execute("test-call", request, undefined, undefined, { cwd } as ExtensionContext),
  );
}

async function callFailure(
  tool: CapturedTool,
  cwd: string,
  request: Record<string, unknown>,
): Promise<SyntaxResponse> {
  let parsed: SyntaxResponse | undefined;
  await assert.rejects(
    () => call(tool, cwd, request),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      parsed = JSON.parse(error.message) as SyntaxResponse;
      return true;
    },
  );
  if (!parsed) throw new Error("expected Astrolabe tool failure");
  return parsed;
}

test("inspect path returns an executable next action and continuation source lookup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-index-"));
  await writeFile(join(dir, "sample.ts"), "function answer() { return 1; }\n");
  const tool = setup(dir);
  const outlined = await call(tool, dir, {
    action: "inspect",
    path: "sample.ts",
    detail: "outline",
  });
  const outlinedResponse = responseOf(outlined);
  assert.equal(outlinedResponse.ok, true);
  assert.match(outlinedResponse.outline ?? "", /answer/);
  const next = outlinedResponse.next?.[0];
  assert.ok(next);

  const sourced = await call(tool, dir, next);
  const sourcedResponse = responseOf(sourced);
  assert.equal(sourcedResponse.ok, true);
  assert.match(sourcedResponse.source ?? "", /return 1/);
  assert.equal("structure" in (sourcedResponse.data ?? {}), false);
  assert.doesNotMatch(sourced.content[0]?.text ?? "", /\n/);
  assert.equal(sourcedResponse.next?.[0]?.action, "edit");
});

test("inspect_many reads selected continuations across files without proposing cross-file mutation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-index-"));
  await writeFile(join(dir, "first.ts"), "function first() { return 1; }\n");
  await writeFile(join(dir, "second.ts"), "function second() { return 2; }\n");
  const tool = setup(dir);

  const firstOutline = responseOf(
    await call(tool, dir, { action: "inspect", path: "first.ts", detail: "outline" }),
  );
  const secondOutline = responseOf(
    await call(tool, dir, { action: "inspect", path: "second.ts", detail: "outline" }),
  );
  const first = firstOutline.next?.[0] as { continuation?: { token: string } } | undefined;
  const second = secondOutline.next?.[0] as { continuation?: { token: string } } | undefined;
  assert.ok(first?.continuation);
  assert.ok(second?.continuation);

  const inspected = responseOf(
    await call(tool, dir, {
      action: "inspect_many",
      targets: [{ continuation: first.continuation }, { continuation: second.continuation }],
    }),
  );
  assert.equal(inspected.ok, true);
  assert.equal(inspected.data?.sources?.length, 2);
  assert.match(inspected.data?.sources?.[0]?.source ?? "", /function first/);
  assert.match(inspected.data?.sources?.[1]?.source ?? "", /function second/);
  assert.equal(inspected.next, undefined);
});

test("locate returns a ranked source-inspected candidate usable for direct replacement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-index-"));
  const path = join(dir, "sample.ts");
  await writeFile(
    path,
    "class Parser { parse(input: string) { return input.trim(); } }\nfunction fallback() { return null; }\n",
  );
  const tool = setup(dir);
  const located = await call(tool, dir, {
    action: "locate",
    scope: "sample.ts",
    symbols: ["Parser.parse"],
    terms: ["trim"],
    maxCandidates: 1,
  });
  const response = responseOf(located);
  assert.equal(response.ok, true);
  assert.equal(response.data?.candidateCount, 1);
  assert.equal(response.data?.mode, "source");
  const metrics = located.details.metrics as {
    actions: Record<string, number>;
    locatedCandidates: number;
    locatedSources: number;
  };
  assert.equal(metrics.actions.locate, 1);
  assert.equal(metrics.locatedCandidates, 1);
  assert.equal(metrics.locatedSources, 1);
  const candidate = response.data?.candidates?.[0];
  assert.equal(candidate?.name, "parse");
  assert.match(candidate?.source ?? "", /return input\.trim/);

  const replaced = await call(tool, dir, {
    action: "edit",
    continuation: candidate?.continuation,
    replacement: "parse(input: string) { return input.toLowerCase(); }",
  });
  assert.equal(responseOf(replaced).ok, true);
  assert.match(await readFile(path, "utf8"), /toLowerCase/);
});

test("locate omits bodies for ambiguous candidates and selected cards can be inspected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-index-"));
  await writeFile(
    join(dir, "sample.ts"),
    "function first() { return parse(); }\nfunction second() { return parse(); }\n",
  );
  const tool = setup(dir);
  const located = await call(tool, dir, {
    action: "locate",
    scope: "sample.ts",
    terms: ["parse"],
  });
  const response = responseOf(located);
  assert.equal(response.ok, true);
  assert.equal(response.data?.mode, "cards");
  const metrics = located.details.metrics as { locatedCards: number };
  assert.equal(metrics.locatedCards, 1);
  const candidate = response.data?.candidates?.[0];
  assert.equal(candidate?.source, undefined);
  assert.match(candidate?.signature ?? "", /function first/);
  assert.deepEqual(candidate?.flow.calls, ["parse"]);
  const inspected = await call(tool, dir, {
    action: "inspect",
    continuation: candidate?.continuation,
    detail: "source",
  });
  assert.match(responseOf(inspected).source ?? "", /function first/);
});

test("locate omits a high-confidence body that exceeds its size limit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-index-"));
  await writeFile(join(dir, "sample.ts"), `function parse() { return "${"x".repeat(6_000)}"; }\n`);
  const tool = setup(dir);
  const located = await call(tool, dir, {
    action: "locate",
    scope: "sample.ts",
    symbols: ["parse"],
  });
  const response = responseOf(located);
  assert.equal(response.ok, true);
  assert.equal(response.data?.mode, "cards");
  assert.equal(response.data?.candidates?.[0]?.source, undefined);
});

test("locate rejects missing hints and returns no-candidate failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-index-"));
  await writeFile(join(dir, "sample.ts"), "function answer() { return 1; }\n");
  const tool = setup(dir);
  const missingHint = await callFailure(tool, dir, { action: "locate", scope: "sample.ts" });
  assert.equal(missingHint.ok, false);
  assert.equal(missingHint.error?.code, "locate_requires_hint");
  const noCandidatesResult = await call(tool, dir, {
    action: "locate",
    scope: "sample.ts",
    symbols: ["missing"],
  });
  const noCandidates = responseOf(noCandidatesResult);
  assert.equal(noCandidates.ok, true);
  assert.equal(noCandidates.message, "no_match");
  assert.equal(noCandidates.data?.candidateCount, 0);
  assert.deepEqual(noCandidates.data?.candidates, []);
});

test("directory search returns continuations usable for edit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-index-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "function answer() { return 1; }\nanswer();\n");
  const tool = setup(dir);
  const searched = await call(tool, dir, {
    action: "search",
    scope: dir,
    kind: "function",
    name: "answer",
  });
  const searchedResponse = responseOf(searched);
  assert.equal(searchedResponse.ok, true);
  assert.equal(searchedResponse.data?.matchCount, 1);
  const continuation = (
    searchedResponse.next?.[0] as { continuation?: { token: string } } | undefined
  )?.continuation;
  assert.ok(continuation);

  const replaced = await call(tool, dir, {
    action: "edit",
    continuation,
    replacement: "function answer() { return 2; }",
  });
  assert.equal(responseOf(replaced).ok, true);
  assert.match(await readFile(path, "utf8"), /return 2/);
});

test("edit invalidates its old continuation and returns a fresh recovery target", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-index-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "function answer() { return 1; }\n");
  const tool = setup(dir);
  const located = responseOf(
    await call(tool, dir, {
      action: "locate",
      scope: "sample.ts",
      symbols: ["answer"],
      maxCandidates: 1,
    }),
  );
  const continuation = located.data?.candidates?.[0]?.continuation;
  assert.ok(continuation);

  const edited = responseOf(
    await call(tool, dir, {
      action: "edit",
      continuation,
      replacement: "function answer() { return 2; }",
    }),
  );
  assert.equal(edited.ok, true);
  const next = edited.next?.[0];
  assert.ok(next);
  assert.equal(next.action, "inspect");

  const reused = await callFailure(tool, dir, {
    action: "edit",
    continuation,
    replacement: "function answer() { return 3; }",
  });
  assert.equal(reused.error?.code, "invalid_continuation");

  const refreshed = responseOf(await call(tool, dir, next));
  assert.equal(refreshed.ok, true);
  assert.match(refreshed.source ?? "", /return 2/);
});

test("edit rejects a changed target without writing and returns recovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-index-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "function answer() { return 1; }\n");
  const tool = setup(dir);
  const searched = await call(tool, dir, {
    action: "search",
    scope: "sample.ts",
    kind: "function",
    name: "answer",
  });
  const searchedResponse = responseOf(searched);
  const continuation = (
    searchedResponse.next?.[0] as { continuation?: { token: string } } | undefined
  )?.continuation;
  assert.ok(continuation);
  await writeFile(path, "function answer() { return 99; }\n");

  const replacedResponse = await callFailure(tool, dir, {
    action: "edit",
    continuation,
    replacement: "function answer() { return 2; }",
  });
  assert.equal(replacedResponse.ok, false);
  assert.equal(replacedResponse.error?.code, "stale_node");
  assert.ok(replacedResponse.next?.[0]);
  assert.match(await readFile(path, "utf8"), /return 99/);
});

test("source request without a target returns a directly executable recovery action", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-index-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "function answer() {}\n");
  const tool = setup(dir);
  const failedResponse = await callFailure(tool, dir, {
    action: "inspect",
    path,
    detail: "source",
  });
  assert.equal(failedResponse.ok, false);
  const next = failedResponse.next?.[0];
  assert.ok(next);
  const recovered = await call(tool, dir, next);
  const recoveredResponse = responseOf(recovered);
  assert.equal(recoveredResponse.ok, true);
  assert.match(recoveredResponse.outline ?? "", /answer/);
});
