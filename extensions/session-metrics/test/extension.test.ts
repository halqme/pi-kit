import assert from "node:assert/strict";
import test from "node:test";
import sessionMetricsExtension from "../index.ts";

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

test("returns an empty report with a missing-source diagnostic from execute", async () => {
  const missing = "/definitely/missing/pi-session-metrics";
  let tool: { execute: (...args: any[]) => Promise<unknown> } | undefined;
  sessionMetricsExtension({
    registerTool(value: typeof tool) {
      tool = value;
    },
  } as never);
  const registeredTool = tool;
  assert.ok(registeredTool);
  const result = (await registeredTool.execute(
    "test-call",
    { sessionsPath: missing },
    undefined,
    undefined,
    { cwd: process.cwd() },
  )) as { content: Array<{ type: string; text?: string }> };
  const content = result.content.find((item) => item.type === "text")?.text;
  assert.ok(content);
  const parsed = JSON.parse(content) as {
    data: { kind: string; metrics: { sessions: number } };
    source?: { path: string; status: string; code: string; message: string };
  };
  assert.equal(parsed.data.kind, "overview");
  assert.equal(parsed.data.metrics.sessions, 0);
  assert.ok(parsed.source);
  assert.equal(parsed.source.path, missing);
  assert.equal(parsed.source.status, "missing");
  assert.equal(parsed.source.code, "ENOENT");
  assert.match(parsed.source.message, /ENOENT/);
});
