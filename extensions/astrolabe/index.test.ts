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
  details: { response: SyntaxResponse };
  isError?: boolean;
}

function result(value: unknown): ToolResult {
  return value as ToolResult;
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
  assert.equal(outlined.details.response.ok, true);
  assert.match(outlined.details.response.data?.outline ?? "", /answer/);
  const next = outlined.details.response.next?.[0];
  assert.deepEqual(JSON.parse(outlined.content[0]?.text ?? "{}"), outlined.details.response);
  assert.ok(next);

  const sourced = await call(tool, dir, next);
  assert.equal(sourced.details.response.ok, true);
  assert.match(sourced.details.response.data?.source ?? "", /return 1/);
  assert.ok(sourced.details.response.handles?.[0]?.capabilities.includes("replace"));
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
  assert.equal(searched.details.response.ok, true);
  assert.equal(searched.details.response.data?.matchCount, 1);
  const continuation = searched.details.response.handles?.[0]?.continuation;
  assert.ok(continuation);

  const replaced = await call(tool, dir, {
    action: "replace",
    continuation,
    replacement: "function answer() { return 2; }",
  });
  assert.equal(replaced.details.response.ok, true);
  assert.match(await readFile(path, "utf8"), /return 2/);
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
  const continuation = searched.details.response.handles?.[0]?.continuation;
  assert.ok(continuation);
  await writeFile(path, "function answer() { return 99; }\n");

  const replaced = await call(tool, dir, {
    action: "replace",
    continuation,
    replacement: "function answer() { return 2; }",
  });
  assert.equal(replaced.details.response.ok, false);
  assert.equal(replaced.details.response.error?.code, "stale_node");
  assert.ok(replaced.details.response.next?.[0]);
  assert.match(await readFile(path, "utf8"), /return 99/);
});

test("source request without a target returns a directly executable recovery action", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-index-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "function answer() {}\n");
  const tool = setup(dir);
  const failed = await call(tool, dir, { action: "inspect", path, detail: "source" });
  assert.equal(failed.details.response.ok, false);
  const next = failed.details.response.next?.[0];
  assert.ok(next);
  const recovered = await call(tool, dir, next);
  assert.equal(recovered.details.response.ok, true);
  assert.match(recovered.details.response.data?.outline ?? "", /answer/);
});
