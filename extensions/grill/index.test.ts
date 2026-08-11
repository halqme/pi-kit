import assert from "node:assert/strict";
import test from "node:test";
import grill from "./index.ts";

test("grill resolves a grounded architecture through the public tool flow", async () => {
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
  grill(pi);
  const tool = tools.get("grill");
  const ctx = { sessionManager: { getEntries: () => entries } };

  const started = await tool.execute(
    "1",
    { action: "start", goal: "split the implementation" },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(started.details.status, "grilling");

  const invalid = await tool.execute(
    "2",
    { action: "resolve", architecture: "   " },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(invalid.isError, true);

  const resolved = await tool.execute(
    "3",
    { action: "resolve", architecture: "Use focused modules with explicit boundaries." },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(resolved.details.status, "resolved");
  assert.equal(resolved.details.architecture, "Use focused modules with explicit boundaries.");
});
