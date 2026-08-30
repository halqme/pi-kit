import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import extension from "../index.ts";

type RegisteredTool = {
  name: string;
  execute: (
    id: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    update: unknown,
    ctx: { cwd: string },
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
};

function setupRepositoryTools(): {
  tools: RegisteredTool[];
  shutdown: Array<() => Promise<void> | void>;
} {
  const tools: RegisteredTool[] = [];
  const shutdown: Array<() => Promise<void> | void> = [];
  extension({
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
    on(event: string, handler: () => Promise<void> | void) {
      if (event === "session_shutdown") shutdown.push(handler);
    },
  } as never);
  return { tools, shutdown };
}

test("exposes repository capabilities and keeps code reachable without context", async () => {
  const { tools, shutdown } = setupRepositoryTools();

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["context", "code"],
  );
  assert.equal(
    tools.some((tool) => tool.name === "astrolabe"),
    false,
  );
  assert.equal(
    tools.some((tool) => tool.name === "bm25_search"),
    false,
  );

  const context = tools.find((tool) => tool.name === "context");
  const code = tools.find((tool) => tool.name === "code");
  assert.ok(context);
  assert.ok(code);

  const dir = await mkdtemp(join(tmpdir(), "repository-surface-"));
  await writeFile(join(dir, "sample.ts"), "export const answer = 1;\n", "utf8");
  const signal = new AbortController().signal;

  const inspected = await context.execute(
    "context-source",
    { action: "inspect", path: "sample.ts", detail: "source" },
    signal,
    undefined,
    { cwd: dir },
  );
  const inspection = JSON.parse(inspected.content[0]?.text ?? "{}") as {
    ok?: boolean;
    source?: string;
    data?: { mode?: string };
  };
  assert.equal(inspection.ok, true);
  assert.equal(inspection.data?.mode, "source");
  assert.equal(inspection.source, "export const answer = 1;\n");

  const edited = await code.execute(
    "code-edit",
    {
      action: "edit",
      path: "sample.ts",
      oldText: "answer = 1",
      newText: "answer = 2",
    },
    signal,
    undefined,
    { cwd: dir },
  );
  const mutation = JSON.parse(edited.content[0]?.text ?? "{}") as {
    ok?: boolean;
    data?: { mode?: string; targetType?: string };
  };
  assert.equal(mutation.ok, true);
  assert.equal(mutation.data?.mode, "text");
  assert.equal(mutation.data?.targetType, "variable_declarator");
  assert.equal(await readFile(join(dir, "sample.ts"), "utf8"), "export const answer = 2;\n");

  for (const handler of shutdown) await handler();
});

test("exact text edits invalidate overlapping structural continuations", async () => {
  const { tools, shutdown } = setupRepositoryTools();
  const context = tools.find((tool) => tool.name === "context");
  const code = tools.find((tool) => tool.name === "code");
  assert.ok(context);
  assert.ok(code);

  const dir = await mkdtemp(join(tmpdir(), "repository-continuation-"));
  await writeFile(join(dir, "sample.ts"), "export const answer = 1;\n", "utf8");
  const signal = new AbortController().signal;

  const outlined = await context.execute(
    "context-outline",
    { action: "inspect", path: "sample.ts", detail: "outline" },
    signal,
    undefined,
    { cwd: dir },
  );
  const outline = JSON.parse(outlined.content[0]?.text ?? "{}") as {
    next?: Array<{ continuation?: { token: string } }>;
  };
  const continuation = outline.next?.[0]?.continuation;
  assert.ok(continuation);

  await code.execute(
    "code-text-edit",
    {
      action: "edit",
      path: "sample.ts",
      oldText: "answer = 1",
      newText: "answer = 2",
    },
    signal,
    undefined,
    { cwd: dir },
  );

  await assert.rejects(
    code.execute(
      "code-stale-edit",
      { action: "edit", continuation, replacement: "export const answer = 3;" },
      signal,
      undefined,
      { cwd: dir },
    ),
    /invalid_continuation|stale_node/,
  );

  for (const handler of shutdown) await handler();
});

test("bare source inspection degrades large files to outline", async () => {
  const { tools, shutdown } = setupRepositoryTools();
  const context = tools.find((tool) => tool.name === "context");
  assert.ok(context);

  const dir = await mkdtemp(join(tmpdir(), "repository-large-source-"));
  const source = Array.from({ length: 500 }, (_, index) => `export const value${index} = ${index};`).join("\n");
  await writeFile(join(dir, "large.ts"), `${source}\n`, "utf8");
  const signal = new AbortController().signal;

  const inspected = await context.execute(
    "context-large-source",
    { action: "inspect", path: "large.ts", detail: "source" },
    signal,
    undefined,
    { cwd: dir },
  );
  const inspection = JSON.parse(inspected.content[0]?.text ?? "{}") as {
    source?: string;
    outline?: string;
    data?: { mode?: string; sourceBytes?: number };
  };
  assert.equal(inspection.data?.mode, "outline");
  assert.equal(inspection.source, undefined);
  assert.ok(inspection.outline);
  assert.ok((inspection.data?.sourceBytes ?? 0) > 6_000);

  for (const handler of shutdown) await handler();
});
