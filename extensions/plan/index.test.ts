import assert from "node:assert/strict";
import test from "node:test";
import grill from "../grill/index.ts";
import planner from "../planner/index.ts";
import runner from "../runner/index.ts";
import planExtension from "./index.ts";

test("grill, planner, and runner share session state through the public tool flow", async () => {
  const tools = new Map<string, any>();
  const entries: any[] = [];
  const pi: any = {
    registerTool(tool: any) {
      tools.set(tool.name, tool);
    },
    appendEntry(type: string, data: unknown) {
      entries.push({ type: "custom", customType: type, data });
    },
    on(_name: string, _handler: unknown) {},
  };
  const ctx: any = { sessionManager: { getEntries: () => entries } };
  grill(pi);
  planner(pi);
  runner(pi);

  await tools
    .get("grill")
    .execute("1", { action: "start", goal: "split planning" }, undefined, undefined, ctx);
  const resolved = await tools
    .get("grill")
    .execute(
      "2",
      { action: "resolve", architecture: "Use four focused extensions." },
      undefined,
      undefined,
      ctx,
    );
  assert.equal(resolved.details.status, "resolved");
  const planned = await tools.get("planner").execute(
    "3",
    {
      action: "create",
      architecture: resolved.details.architecture,
      steps: ["Implement shared state", "Run integration tests"],
    },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(planned.details.status, "planned");
  const approved = await tools
    .get("planner")
    .execute("4", { action: "approve" }, undefined, undefined, ctx);
  assert.equal(approved.details.status, "approved");
  const started = await tools
    .get("runner")
    .execute("5", { action: "start" }, undefined, undefined, ctx);
  assert.equal(started.details.status, "running");
  const progress = await tools
    .get("runner")
    .execute("6", { action: "progress", steps: [1, 2] }, undefined, undefined, ctx);
  assert.equal(progress.details.status, "running");
  const completed = await tools
    .get("runner")
    .execute(
      "7",
      { action: "finish", evidence: "All TODO steps were verified." },
      undefined,
      undefined,
      ctx,
    );
  assert.equal(completed.details.status, "completed");
});

test("plan extension injects light guidance and supports /plan light", async () => {
  let command: any;
  let beforeAgentStart: any;
  const messages: string[] = [];
  const notifications: string[] = [];
  const pi: any = {
    registerCommand(name: string, value: any) {
      assert.equal(name, "plan");
      command = value;
    },
    on(name: string, handler: any) {
      if (name === "before_agent_start") beforeAgentStart = handler;
    },
    sendUserMessage(message: string) {
      messages.push(message);
    },
  };
  planExtension(pi);

  const started = await beforeAgentStart({ systemPrompt: "base" });
  assert.match(started.systemPrompt, /<light-plan>/);
  assert.match(started.systemPrompt, /concise 2-4 step light plan/);
  assert.match(started.systemPrompt, /delegation candidate/);

  await command.handler("light", {
    ui: {
      notify: async (message: string) => {
        notifications.push(message);
      },
    },
  });
  assert.deepEqual(notifications, ["Light plan requested."]);
  assert.match(messages[0] ?? "", /concise 2-4 step light plan/);
  assert.match(messages[0] ?? "", /do not invoke the full grill\/planner\/runner workflow/);
});
