import assert from "node:assert/strict";
import test from "node:test";
import sessionMetricsExtension from "./index.ts";

test("registers one passive session metrics tool without session hooks", () => {
  const tools: Array<{ name: string }> = [];
  const hooks: string[] = [];
  const pi = {
    on(name: string) {
      hooks.push(name);
    },
    registerTool(tool: { name: string }) {
      tools.push(tool);
    },
  };
  sessionMetricsExtension(pi as never);
  assert.deepEqual(tools.map((tool) => tool.name), ["session_metrics"]);
  assert.deepEqual(hooks, []);
});
