import assert from "node:assert/strict";
import test from "node:test";
import extension from "./index.ts";

function harness() {
  const entries: unknown[] = [];
  const tools = new Map<string, any>();
  const pi = {
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ type: "custom", customType, data });
    },
  } as any;
  extension(pi);
  const ctx = {
    cwd: process.cwd(),
    sessionManager: { getEntries: () => entries },
  } as any;
  return { tools, ctx };
}

async function call(tool: any, params: Record<string, unknown>, ctx: any) {
  return tool.execute("call", params, new AbortController().signal, undefined, ctx);
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
  const text = result.content[0]?.text ?? "{}";
  assert.equal(JSON.parse(text).status, "done");
});
