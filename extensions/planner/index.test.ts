import assert from "node:assert/strict";
import test from "node:test";
import planner from "./index.ts";

test("planner creates and approves a TODO through the public tool flow", async () => {
  const tools = new Map<string, any>();
  const entries: any[] = [];
  const pi: any = {
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    appendEntry(type: string, data: unknown) {
      entries.push({ type: "custom", customType: type, data });
    },
  };
  planner(pi);
  const tool = tools.get("planner");
  const ctx = { sessionManager: { getEntries: () => entries } };

  const rejected = await tool.execute("1", { action: "approve" }, undefined, undefined, ctx);
  assert.equal(rejected.isError, true);

  const created = await tool.execute(
    "2",
    {
      action: "create",
      architecture: "Use focused modules with explicit boundaries.",
      steps: ["Implement the boundary", "Verify the public flow"],
    },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(created.details.status, "planned");
  assert.match(created.details.todo, /1\. Implement the boundary/);
  assert.match(created.details.todo, /2\. Verify the public flow/);

  const approved = await tool.execute("3", { action: "approve" }, undefined, undefined, ctx);
  assert.equal(approved.details.status, "approved");
});
