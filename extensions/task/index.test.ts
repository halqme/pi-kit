import assert from "node:assert/strict";
import test from "node:test";
import extension from "./index.ts";

function harness() {
  const entries: unknown[] = [];
  const tools = new Map<string, any>();
  const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
  const pi = {
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ type: "custom", customType, data });
    },
    on(event: string, handler: (event: any, ctx: any) => unknown) {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
  } as any;
  extension(pi);
  const ctx = {
    cwd: process.cwd(),
    sessionManager: {
      getEntries: () => entries,
      getLeafId: () => "assistant-entry",
    },
  } as any;
  const emit = async (event: string, value: any) => {
    for (const handler of handlers.get(event) ?? []) await handler(value, ctx);
  };
  return { tools, ctx, emit };
}

async function call(tool: any, params: Record<string, unknown>, ctx: any) {
  return tool.execute("call", params, new AbortController().signal, undefined, ctx);
}

function parsed(result: any): any {
  return JSON.parse(result.content[0]?.text ?? "{}");
}

test("reported evidence cannot self-certify completion", async () => {
  const { tools, ctx } = harness();
  const task = tools.get("task");
  const verify = tools.get("verify");
  await call(task, { action: "start", goal: "demo" }, ctx);
  await call(
    verify,
    { action: "record", provenance: "typecheck", passed: true, summary: "reported only" },
    ctx,
  );
  await assert.rejects(() => call(task, { action: "finish", summary: "done" }, ctx), /verify\.run/);
});

test("an executed passing check permits completion", async () => {
  const { tools, ctx } = harness();
  const task = tools.get("task");
  const verify = tools.get("verify");
  await call(task, { action: "start", goal: "demo" }, ctx);
  await call(
    verify,
    {
      action: "run",
      provenance: "typecheck",
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      summary: "node check",
    },
    ctx,
  );
  const result = await call(task, { action: "finish", summary: "done" }, ctx);
  assert.equal(parsed(result).status, "done");
});

test("review_context reports successful explicit resource activity", async () => {
  const { tools, ctx, emit } = harness();
  const task = tools.get("task");
  await call(task, { action: "start", goal: "keep docs and code aligned" }, ctx);

  await emit("tool_call", {
    type: "tool_call",
    toolCallId: "read-1",
    toolName: "read",
    input: { path: "extensions/task/README.md" },
  });
  await emit("tool_result", {
    type: "tool_result",
    toolCallId: "read-1",
    toolName: "read",
    input: { path: "extensions/task/README.md" },
    content: [{ type: "text", text: "task docs" }],
    details: undefined,
    isError: false,
  });

  await emit("tool_call", {
    type: "tool_call",
    toolCallId: "edit-1",
    toolName: "edit",
    input: { path: "extensions/task/runtime.ts", oldText: "a", newText: "b" },
  });
  await emit("tool_result", {
    type: "tool_result",
    toolCallId: "edit-1",
    toolName: "edit",
    input: { path: "extensions/task/runtime.ts", oldText: "a", newText: "b" },
    content: [{ type: "text", text: "edited" }],
    details: undefined,
    isError: false,
  });

  const review = parsed(await call(task, { action: "review_context" }, ctx));
  assert.deepEqual(review.resources.observed, ["extensions/task/README.md"]);
  assert.deepEqual(review.resources.mutated, ["extensions/task/runtime.ts"]);
  assert.equal(review.resources.timeline[0].assistantEntryId, "assistant-entry");
  assert.equal(review.resources.coverage.opaqueToolEffects, "not-attributed");
});

test("failed mutations are not recorded as task resource events", async () => {
  const { tools, ctx, emit } = harness();
  const task = tools.get("task");
  await call(task, { action: "start", goal: "demo" }, ctx);

  await emit("tool_call", {
    type: "tool_call",
    toolCallId: "edit-failed",
    toolName: "edit",
    input: { path: "extensions/task/runtime.ts", oldText: "a", newText: "b" },
  });
  await emit("tool_result", {
    type: "tool_result",
    toolCallId: "edit-failed",
    toolName: "edit",
    input: { path: "extensions/task/runtime.ts", oldText: "a", newText: "b" },
    content: [{ type: "text", text: "failed" }],
    details: undefined,
    isError: true,
  });

  const review = parsed(await call(task, { action: "review_context" }, ctx));
  assert.deepEqual(review.resources.mutated, []);
  assert.deepEqual(review.resources.timeline, []);
});

test("context findings are available as best-effort observations", async () => {
  const { tools, ctx, emit } = harness();
  const task = tools.get("task");
  await call(task, { action: "start", goal: "demo" }, ctx);

  await emit("tool_call", {
    type: "tool_call",
    toolCallId: "context-1",
    toolName: "context",
    input: { action: "find", query: "task runtime" },
  });
  await emit("tool_result", {
    type: "tool_result",
    toolCallId: "context-1",
    toolName: "context",
    input: { action: "find", query: "task runtime" },
    content: [{ type: "text", text: "results" }],
    details: { results: [{ path: "extensions/task/runtime.ts" }] },
    isError: false,
  });

  const review = parsed(await call(task, { action: "review_context" }, ctx));
  assert.deepEqual(review.resources.observed, ["extensions/task/runtime.ts"]);
});
