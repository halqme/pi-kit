import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import grillPlanExtension from "./index.ts";

type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<unknown>;
type EventHandler = (event: unknown, ctx: ExtensionContext) => Promise<unknown>;

interface CapturedTool {
  name: string;
  execute: (
    toolCallId: string,
    params: { completedSteps: number[] },
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: ExtensionContext,
  ) => Promise<{ isError?: boolean }>;
}

test("plan-execute starts a turn, records completion, and rejects replay", async () => {
  const commands = new Map<string, CommandHandler>();
  const events = new Map<string, EventHandler>();
  const tools = new Map<string, CapturedTool>();
  const notifications: Array<{ message: string; level: string }> = [];
  const sentUserMessages: string[] = [];
  const appendedStates: unknown[] = [];
  const baselineTools = ["read", "bash", "edit", "write"];
  let activeTools = [...baselineTools];
  let shortcutCount = 0;
  let runtimeActive = false;

  const pi = {
    registerFlag() {},
    registerTool(definition: CapturedTool) {
      tools.set(definition.name, definition);
      activeTools.push(definition.name);
    },
    registerCommand(name: string, definition: { handler: CommandHandler }) {
      commands.set(name, definition.handler);
    },
    registerShortcut() {
      shortcutCount += 1;
    },
    on(name: string, handler: EventHandler) {
      events.set(name, handler);
    },
    getFlag() {
      return false;
    },
    getActiveTools() {
      if (!runtimeActive) throw new Error("Extension runtime not initialized");
      return [...activeTools];
    },
    getAllTools() {
      return [...baselineTools, ...tools.keys()].map((name) => ({ name }));
    },
    setActiveTools(names: string[]) {
      if (!runtimeActive) throw new Error("Extension runtime not initialized");
      activeTools = [...names];
    },
    appendEntry(_customType: string, data: unknown) {
      appendedStates.push(data);
    },
    sendUserMessage(content: string) {
      sentUserMessages.push(content);
    },
  } as unknown as ExtensionAPI;

  const storedPlan = {
    phase: "ready",
    goal: "Fix auth",
    planText:
      "課題:\nAuth fails\n\n原因:\nToken missing\n\n修正するべき点:\nRestore token\n\n対処法:\nInitialize auth\n\n実際に編集するファイル:\nsrc/auth.ts\n\nPlan:\n1. Update auth\n2. Run tests",
    steps: [
      { step: 1, text: "Update auth", completed: false },
      { step: 2, text: "Run tests", completed: false },
    ],
    toolsBeforePlanning: baselineTools,
  };
  const ctx = {
    cwd: "/workspace",
    hasUI: false,
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      confirm: async () => true,
      setStatus() {},
      setWidget() {},
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
    },
    sessionManager: {
      getEntries: () => [{ type: "custom", customType: "grill-plan-state", data: storedPlan }],
      getSessionFile: () => undefined,
      getSessionId: () => "current-session",
      getSessionDir: () => "/sessions",
    },
  } as unknown as ExtensionContext;

  grillPlanExtension(pi);
  assert.equal(shortcutCount, 0);
  assert.ok(commands.has("plan"));
  assert.ok(!commands.has("plan-execute"));
  assert.ok(!commands.has("plan-restore"));
  assert.ok(!commands.has("plan-refine"));
  assert.ok(!commands.has("plan-status"));
  assert.ok(!commands.has("plan-cancel"));
  runtimeActive = true;
  await events.get("session_start")?.({ reason: "startup" }, ctx);
  await commands.get("plan")?.("execute", ctx);

  assert.equal(sentUserMessages.length, 1);
  assert.match(sentUserMessages[0]!, /Execute the approved plan/);
  assert.ok(activeTools.includes("grill_plan_progress"));

  const progressTool = tools.get("grill_plan_progress");
  assert.ok(progressTool);
  const result = await progressTool.execute(
    "call-1",
    { completedSteps: [1, 2] },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(result.isError, undefined);
  assert.ok(!activeTools.includes("grill_plan_progress"));
  assert.match(notifications.at(-1)?.message ?? "", /completed/);
  assert.equal((appendedStates.at(-1) as { phase?: string }).phase, "idle");

  await commands.get("plan")?.("execute", ctx);
  assert.equal(sentUserMessages.length, 1);
  assert.match(notifications.at(-1)?.message ?? "", /No executable plan/);

  (ctx as unknown as { hasUI: boolean }).hasUI = true;
  const startTool = tools.get("grill_plan_start");
  assert.ok(startTool);
  const startParams = {
    completedSteps: [],
    goal: "assistant-generated task text must not become user approval",
  };
  const startResult = await startTool.execute("call-2", startParams, undefined, undefined, ctx);
  assert.equal(startResult.isError, undefined);
  assert.equal(sentUserMessages.length, 1);
  assert.equal((appendedStates.at(-1) as { phase?: string }).phase, "planning");

  await commands.get("plan")?.("hogehoge", ctx);
  assert.equal(sentUserMessages.length, 2);
  assert.equal(sentUserMessages.at(-1), "hogehoge");
  assert.equal((appendedStates.at(-1) as { goal?: string }).goal, "hogehoge");
});
