import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import extension from "./index.ts";

const exec = promisify(execFile);

function harness(cwd = process.cwd()) {
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
    cwd,
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

test("an expected non-zero exit is successful verification evidence", async () => {
  const { tools, ctx } = harness();
  const task = tools.get("task");
  const verify = tools.get("verify");
  await call(task, { action: "start", goal: "negative test" }, ctx);
  const verification = parsed(
    await call(
      verify,
      {
        action: "run",
        provenance: "existing_test",
        command: process.execPath,
        args: ["-e", "process.exit(7)"],
        expectedExitCodes: [7],
        summary: "expected failure case",
      },
      ctx,
    ),
  );

  assert.equal(verification.evidence.passed, true);
  assert.equal(verification.exitCode, 7);
  assert.deepEqual(verification.expectedExitCodes, [7]);
  const result = await call(task, { action: "finish", summary: "done" }, ctx);
  assert.equal(parsed(result).status, "done");
});

test("an unexpected exit remains a verification error", async () => {
  const { tools, ctx } = harness();
  const verify = tools.get("verify");
  await assert.rejects(
    () =>
      call(
        verify,
        {
          action: "run",
          provenance: "existing_test",
          command: process.execPath,
          args: ["-e", "process.exit(3)"],
          expectedExitCodes: [0, 2],
          summary: "wrong exit",
        },
        ctx,
      ),
    /execution_failure: wrong exit failed \(exit 3; expected 0, 2\)/,
  );
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

test("review_context requires a matching independent reviewer report", async () => {
  const { tools, ctx } = harness();
  const task = tools.get("task");
  const verify = tools.get("verify");
  await call(task, { action: "start", goal: "review contract" }, ctx);
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
  const review = parsed(await call(task, { action: "review_context" }, ctx));

  await assert.rejects(
    () => call(task, { action: "finish", summary: "done" }, ctx),
    /no review_agent report/,
  );
  await call(
    verify,
    { action: "record", provenance: "self_review", passed: true, summary: "parent says okay" },
    ctx,
  );
  await assert.rejects(
    () => call(task, { action: "finish", summary: "done" }, ctx),
    /no review_agent report/,
  );
  await assert.rejects(
    () =>
      call(
        verify,
        { action: "record", provenance: "review_agent", passed: true, summary: "independent" },
        ctx,
      ),
    /reviewRequestId/,
  );
  await call(
    verify,
    {
      action: "record",
      provenance: "review_agent",
      passed: true,
      summary: "independent",
      reviewRequestId: review.reviewRequest.id,
    },
    ctx,
  );
  assert.equal(parsed(await call(task, { action: "finish", summary: "done" }, ctx)).status, "done");
});

test("project-root deltas are visible and clean-start tasks must commit before finish", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-kit-task-root-"));
  const nested = join(root, "extensions", "delegate");
  const sibling = join(root, "sibling.ts");
  await mkdir(nested, { recursive: true });
  await writeFile(join(nested, "keep.txt"), "keep\n");
  await writeFile(sibling, "export const value = 1;\n");
  await exec("git", ["init"], { cwd: root });
  await exec("git", ["config", "user.name", "Pi Kit Test"], { cwd: root });
  await exec("git", ["config", "user.email", "pi-kit@example.invalid"], { cwd: root });
  await exec("git", ["add", "."], { cwd: root });
  await exec("git", ["-c", "commit.gpgSign=false", "commit", "--no-gpg-sign", "-m", "fixture"], {
    cwd: root,
  });

  const { tools, ctx, emit } = harness(nested);
  const task = tools.get("task");
  const verify = tools.get("verify");
  await call(task, { action: "start", goal: "edit a sibling extension" }, ctx);
  await writeFile(sibling, "export const value = 2;\n");
  await emit("tool_call", {
    type: "tool_call",
    toolCallId: "code-root-relative",
    toolName: "code",
    input: { action: "edit", path: "sibling.ts", oldText: "1", newText: "2" },
  });
  await emit("tool_result", {
    type: "tool_result",
    toolCallId: "code-root-relative",
    toolName: "code",
    input: { action: "edit", path: "sibling.ts", oldText: "1", newText: "2" },
    content: [{ type: "text", text: "edited" }],
    details: undefined,
    isError: false,
  });

  const review = parsed(await call(task, { action: "review_context" }, ctx));
  assert.deepEqual(review.resources.changedDuringTask, ["sibling.ts"]);
  assert.deepEqual(review.resources.mutated, ["sibling.ts"]);
  await call(
    verify,
    {
      action: "run",
      provenance: "existing_test",
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      cwd: root,
      summary: "root-scoped check",
    },
    ctx,
  );
  await call(
    verify,
    {
      action: "record",
      provenance: "review_agent",
      passed: true,
      summary: "no inconsistency",
      reviewRequestId: review.reviewRequest.id,
    },
    ctx,
  );

  await assert.rejects(
    () => call(task, { action: "finish", summary: "done" }, ctx),
    /still has uncommitted changes: sibling\.ts/,
  );
  await exec("git", ["add", "sibling.ts"], { cwd: root });
  await exec(
    "git",
    ["-c", "commit.gpgSign=false", "commit", "--no-gpg-sign", "-m", "update sibling"],
    { cwd: root },
  );
  assert.equal(parsed(await call(task, { action: "finish", summary: "done" }, ctx)).status, "done");
});
