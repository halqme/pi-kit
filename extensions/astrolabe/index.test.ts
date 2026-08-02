import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import astrolabe from "./index.ts";

interface CapturedTool {
  execute: (...args: unknown[]) => Promise<unknown>;
}

interface SyntaxResponse {
  ok: boolean;
  action: string;
  data?: { outline?: string; source?: string; matchCount?: number };
  handles?: Array<{ continuation: { token: string }; capabilities: string[] }>;
  next?: Array<Record<string, unknown>>;
  error?: { code: string };
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
  assert.match(outlinedResponse.data?.outline ?? "", /answer/);
  const next = outlinedResponse.next?.[0];
  assert.ok(next);

  const sourced = await call(tool, dir, next);
  const sourcedResponse = responseOf(sourced);
  assert.equal(sourcedResponse.ok, true);
  assert.match(sourcedResponse.data?.source ?? "", /return 1/);
  assert.equal("structure" in (sourcedResponse.data ?? {}), false);
  assert.doesNotMatch(sourced.content[0]?.text ?? "", /\n/);
  assert.equal(sourcedResponse.next?.[0]?.action, "replace");
});

test("directory search returns continuations usable for direct replacement", async () => {
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
    action: "replace",
    continuation,
    replacement: "function answer() { return 2; }",
  });
  assert.equal(responseOf(replaced).ok, true);
  assert.match(await readFile(path, "utf8"), /return 2/);
});

test("replace_many atomically replaces multiple continuations in one file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-index-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "function first() { return 1; }\nfunction second() { return 2; }\n");
  const tool = setup(dir);
  const outlined = await call(tool, dir, {
    action: "inspect",
    path: "sample.ts",
    detail: "outline",
  });
  const next = responseOf(outlined).next ?? [];
  assert.equal(next.length, 2);

  const replaced = await call(tool, dir, {
    action: "replace_many",
    targets: next.map((action, index) => ({
      continuation: (action as { continuation: { token: string } }).continuation,
      replacement: `function ${index === 0 ? "first" : "second"}() { return ${index + 3}; }`,
    })),
  });
  assert.equal(responseOf(replaced).ok, true);
  const output = await readFile(path, "utf8");
  assert.match(output, /function first\(\) \{ return 3; \}/);
  assert.match(output, /function second\(\) \{ return 4; \}/);
});

test("replace_many rejects a stale target without writing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-index-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "function first() { return 1; }\nfunction second() { return 2; }\n");
  const tool = setup(dir);
  const outlined = await call(tool, dir, {
    action: "inspect",
    path: "sample.ts",
    detail: "outline",
  });
  const next = responseOf(outlined).next ?? [];
  await writeFile(path, "function first() { return 99; }\nfunction second() { return 2; }\n");

  const replaced = await call(tool, dir, {
    action: "replace_many",
    targets: next.map((action) => ({
      continuation: (action as { continuation: { token: string } }).continuation,
      replacement: "function changed() { return 0; }",
    })),
  });
  const response = responseOf(replaced);
  assert.equal(response.ok, false);
  assert.equal(response.error?.code, "stale_node");
  assert.match(await readFile(path, "utf8"), /return 99/);
});

test("replace_many rejects a replacement that introduces syntax errors", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-index-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "function first() { return 1; }\nfunction second() { return 2; }\n");
  const tool = setup(dir);
  const outlined = await call(tool, dir, {
    action: "inspect",
    path: "sample.ts",
    detail: "outline",
  });
  const next = responseOf(outlined).next ?? [];
  const replaced = await call(tool, dir, {
    action: "replace_many",
    targets: [
      {
        continuation: (next[0] as { continuation: { token: string } }).continuation,
        replacement: "function broken() {",
      },
      {
        continuation: (next[1] as { continuation: { token: string } }).continuation,
        replacement: "function alsoBroken() {",
      },
    ],
  });
  assert.equal(responseOf(replaced).ok, false);
  assert.match(await readFile(path, "utf8"), /function first\(\) \{ return 1; \}/);
});

test("replace rejects a changed target without writing and returns recovery", async () => {
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

  const replaced = await call(tool, dir, {
    action: "replace",
    continuation,
    replacement: "function answer() { return 2; }",
  });
  const replacedResponse = responseOf(replaced);
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
  const failed = await call(tool, dir, { action: "inspect", path, detail: "source" });
  const failedResponse = responseOf(failed);
  assert.equal(failedResponse.ok, false);
  const next = failedResponse.next?.[0];
  assert.ok(next);
  const recovered = await call(tool, dir, next);
  const recoveredResponse = responseOf(recovered);
  assert.equal(recoveredResponse.ok, true);
  assert.match(recoveredResponse.data?.outline ?? "", /answer/);
});
