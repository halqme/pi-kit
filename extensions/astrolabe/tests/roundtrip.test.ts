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

interface ToolResult {
  content: Array<{ text: string }>;
  isError?: boolean;
}

function setup(): CapturedTool {
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

async function call(tool: CapturedTool, cwd: string, request: Record<string, unknown>) {
  return (await tool.execute("roundtrip-test", request, undefined, undefined, {
    cwd,
  } as ExtensionContext)) as ToolResult;
}

function response(result: ToolResult): any {
  return JSON.parse(result.content[0]?.text ?? "{}");
}

test("high-confidence locate returns source with a direct replace next action", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-roundtrip-"));
  await writeFile(join(dir, "sample.ts"), "function answer() { return 1; }\n");
  const tool = setup();

  const located = response(
    await call(tool, dir, {
      action: "locate",
      scope: "sample.ts",
      symbols: ["answer"],
      maxCandidates: 1,
    }),
  );

  assert.equal(located.data.mode, "source");
  assert.match(located.data.candidates[0].source, /return 1/);
  assert.equal(located.next[0].action, "replace");
  assert.deepEqual(located.next[0].continuation, located.data.candidates[0].continuation);
});

test("card continuations remain directly replaceable when source is not needed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-roundtrip-"));
  const path = join(dir, "sample.ts");
  await writeFile(
    path,
    "function first() { return parse(); }\nfunction second() { return parse(); }\n",
  );
  const tool = setup();

  const located = response(
    await call(tool, dir, { action: "locate", scope: "sample.ts", terms: ["parse"] }),
  );
  assert.equal(located.data.mode, "cards");

  const replaced = response(
    await call(tool, dir, {
      action: "replace",
      continuation: located.data.candidates[0].continuation,
      replacement: "function first() { return 1; }",
    }),
  );

  assert.equal(replaced.ok, true);
  assert.match(await readFile(path, "utf8"), /function first\(\) \{ return 1; \}/);
});

test("inspect_many batches same-file source reads and feeds replace_many", async () => {
  const dir = await mkdtemp(join(tmpdir(), "astrolabe-roundtrip-"));
  const path = join(dir, "sample.ts");
  await writeFile(path, "function first() { return 1; }\nfunction second() { return 2; }\n");
  const tool = setup();

  const outlined = response(
    await call(tool, dir, { action: "inspect", path: "sample.ts", detail: "outline" }),
  );
  const targets = outlined.next.map((item: any) => ({ continuation: item.continuation }));
  const inspected = response(await call(tool, dir, { action: "inspect_many", targets }));

  assert.equal(inspected.ok, true);
  assert.equal(inspected.data.sources.length, 2);
  assert.match(inspected.data.sources[0].source, /function first/);
  assert.match(inspected.data.sources[1].source, /function second/);
  assert.equal(inspected.next[0].action, "replace_many");

  const replaced = response(
    await call(tool, dir, {
      action: "replace_many",
      targets: inspected.next[0].targets.map((target: any, index: number) => ({
        continuation: target.continuation,
        replacement: `function ${index === 0 ? "first" : "second"}() { return ${index + 3}; }`,
      })),
    }),
  );
  assert.equal(replaced.ok, true);
  const output = await readFile(path, "utf8");
  assert.match(output, /first\(\) \{ return 3/);
  assert.match(output, /second\(\) \{ return 4/);
});
