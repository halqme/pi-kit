import assert from "node:assert/strict";
import test from "node:test";
import sessionMetricsExtension from "./index.ts";

test("registers the session metrics tool", () => {
  const tools: Array<{ name: string }> = [];
  const pi = {
    on() {},
    registerTool(tool: { name: string }) {
      tools.push(tool);
    },
  };
  sessionMetricsExtension(pi as never);
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["session_metrics"],
  );
});
