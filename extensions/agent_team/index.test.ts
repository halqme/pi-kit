import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import agentTeamExtension from "./index.ts";

function captureTool(extra: Record<string, unknown> = {}): any {
  let tool: any;
  agentTeamExtension({
    on() {},
    registerTool(value: unknown) {
      tool = value;
    },
    ...extra,
  } as unknown as ExtensionAPI);
  assert.ok(tool);
  return tool;
}

test("agent-team propagates invalid start input as an execute error", async () => {
  const tool = captureTool();

  await assert.rejects(
    () =>
      tool.execute(
        "test-call",
        { action: "start", topic: "   ", members: [] },
        undefined,
        undefined,
        { ui: { setStatus() {} } },
      ),
    /topic is required for start/,
  );
});

test("agent-team exposes only child-safe read-only tools in the tool schema", () => {
  const tool = captureTool();
  const schema = JSON.stringify(tool.parameters);
  for (const name of ["read", "grep", "find", "ls"]) {
    assert.match(schema, new RegExp(`"${name}"`));
  }
  assert.doesNotMatch(schema, /"web_search"/);
  assert.doesNotMatch(schema, /"web_fetch"/);
  assert.doesNotMatch(schema, /"bash"/);
  assert.doesNotMatch(schema, /"astrolabe"/);
});

test("agent-team rejects unsafe tools when direct callers bypass schema validation", async () => {
  const tool = captureTool();

  await assert.rejects(
    () =>
      tool.execute(
        "test-call",
        {
          action: "start",
          topic: "Review this change",
          members: [
            { name: "a", role: "reviewer" },
            { name: "b", role: "skeptic" },
          ],
          tools: ["bash"],
        },
        undefined,
        undefined,
        { ui: { setStatus() {} } },
      ),
    /child-safe read-only tools \(read, grep, find, ls\); unsupported: bash/,
  );
});
