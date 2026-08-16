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
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["session_metrics"],
  );
  assert.deepEqual(hooks, []);
});

test("propagates report failures from execute", async () => {
  let tool: { execute: (...args: any[]) => Promise<unknown> } | undefined;
  sessionMetricsExtension({
    registerTool(value: typeof tool) {
      tool = value;
    },
  } as never);
  const registeredTool = tool;
  assert.ok(registeredTool);
  await assert.rejects(() =>
    registeredTool.execute(
      "test-call",
      { sessionsPath: "/definitely/missing/pi-session-metrics" },
      undefined,
      undefined,
      { cwd: process.cwd() },
    ),
  );
});
