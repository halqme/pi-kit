import test from "node:test";
import assert from "node:assert/strict";
import extension, {
  appendedWatchOutput,
  parseExitCode,
  promptSetupCommand,
  runTerminalPollForTests,
  setTerminalRuntimeForTests,
} from "./index.ts";

test("terminal extension module loads", async () => {
  await import("./index.ts");
});

test("watch output only accepts an appended pane suffix", () => {
  assert.equal(appendedWatchOutput("old\n", "old\nnew ERROR\n"), "new ERROR\n");
  assert.equal(appendedWatchOutput("old\n", "reset ERROR\n"), undefined);
});

test("unknown and out-of-range exit codes become null", () => {
  assert.equal(parseExitCode("0"), 0);
  assert.equal(parseExitCode("255"), 255);
  assert.equal(parseExitCode("256"), null);
  assert.equal(parseExitCode("unknown"), null);
});

test("zsh prompt setup clears prompt hooks and pane history", () => {
  const command = promptSetupCommand("/bin/zsh", "pi-terminal-test");
  assert.match(command, /PROMPT='' PS1='' RPROMPT='' RPS1=''/);
  assert.match(command, /precmd_functions=\(\)/);
  assert.match(command, /unfunction precmd/);
  assert.match(command, /tmux clear-history -t 'pi-terminal-test'/);
});

test("public tool reports busy and unknown terminals and rolls back failed create", async () => {
  const sent: unknown[] = [];
  const killed: string[] = [];
  const tmuxCalls: string[][] = [];
  let failSend = false;
  let now = 0;
  const originalSetInterval = globalThis.setInterval;
  (globalThis as any).setInterval = () => ({}) as any;
  const runtime = {
    async tmux(args: string[]) {
      tmuxCalls.push(args);
      if (args[0] === "new-session") return "";
      if (args[0] === "kill-session") {
        killed.push(args[args.indexOf("-t") + 1]!);
        return "";
      }
      if (args[0] === "send-keys" && failSend) throw new Error("send failed");
      if (args[0] === "capture-pane") return "baseline\n";
      if (args[0] === "has-session") return "";
      return "";
    },
    now: () => now,
    readFile: async () => {
      throw new Error("not finished");
    },
    unlink: async () => {},
  };
  setTerminalRuntimeForTests(runtime);
  let registered: any;
  const events = new Map<string, (event: unknown, ctx: any) => unknown>();
  const entries: any[] = [];
  const pi: any = {
    registerTool(tool: any) {
      registered = tool;
    },
    on(name: string, handler: any) {
      events.set(name, handler);
    },
    appendEntry(type: string, data: unknown) {
      entries.push({ type: "custom", customType: type, data });
    },
    sendMessage(message: unknown) {
      sent.push(message);
    },
  };
  extension(pi);
  const ctx = { cwd: "/tmp", isIdle: () => true, sessionManager: { getEntries: () => entries } };
  await events.get("session_start")?.({}, ctx);
  const created = await registered.execute(
    "1",
    { action: "create", name: "x", command: "sh" },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(created.details.status, "started");
  const newSessionIndex = tmuxCalls.findIndex((call) => call[0] === "new-session");
  assert.match(tmuxCalls[newSessionIndex + 1]?.[4] ?? "", /tmux clear-history/);
  assert.deepEqual(tmuxCalls[newSessionIndex + 2], [
    "send-keys",
    "-t",
    created.details.session,
    "Enter",
  ]);
  assert.equal(tmuxCalls[newSessionIndex + 3]?.[4], "sh");
  const keyResult = await registered.execute(
    "keys",
    { action: "send", name: "x", keys: ["Tab", "C-l", "Left", "Right"] },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(keyResult.details.status, "accepted");
  assert.deepEqual(tmuxCalls.at(-1), [
    "send-keys",
    "-t",
    created.details.session,
    "Tab",
    "C-l",
    "Left",
    "Right",
  ]);
  await assert.rejects(() =>
    registered.execute(
      "text-and-keys",
      { action: "send", name: "x", text: "later", keys: ["Enter"] },
      undefined,
      undefined,
      ctx,
    ),
  );
  const beforeUnknown = tmuxCalls.length;
  const unknown = await registered.execute(
    "unknown",
    { action: "read", name: "stale" },
    undefined,
    undefined,
    ctx,
  );
  assert.deepEqual(unknown.details, {
    status: "not_found",
    reason: "unknown_terminal",
    name: "stale",
    availableNames: ["x"],
  });
  assert.equal(tmuxCalls.length, beforeUnknown);
  const first = await registered.execute(
    "2",
    { action: "call", name: "x", command: "sleep 1" },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(first.details.status, "accepted");
  const beforeBusy = tmuxCalls.length;
  const busy = await registered.execute(
    "3",
    { action: "call", name: "x", command: "echo later" },
    undefined,
    undefined,
    ctx,
  );
  assert.deepEqual(busy.details, {
    status: "busy",
    reason: "pending_call",
    name: "x",
    callId: first.details.callId,
  });
  assert.equal(tmuxCalls.length, beforeBusy);
  now = 1_000_000;
  await runTerminalPollForTests();
  assert.equal(sent.length, 1);
  failSend = true;
  await assert.rejects(() =>
    registered.execute(
      "4",
      { action: "create", name: "y", command: "sh" },
      undefined,
      undefined,
      ctx,
    ),
  );
  assert.equal(killed.length, 1);
  await events.get("session_shutdown")?.({}, ctx);
  globalThis.setInterval = originalSetInterval;
});

test("pending calls and watches restore across session reload", async () => {
  const originalSetInterval = globalThis.setInterval;
  (globalThis as any).setInterval = () => ({}) as any;
  const entries: any[] = [];
  const runtime = {
    async tmux(args: string[]) {
      if (args[0] === "capture-pane") return "baseline\n";
      if (args[0] === "has-session" || args[0] === "new-session" || args[0] === "send-keys")
        return "";
      return "";
    },
    now: () => 100,
    readFile: async () => {
      throw new Error("not finished");
    },
    unlink: async () => {},
  };
  setTerminalRuntimeForTests(runtime);

  let tool: any;
  const firstEvents = new Map<string, any>();
  const firstPi: any = {
    registerTool(value: any) {
      tool = value;
    },
    on(name: string, handler: any) {
      firstEvents.set(name, handler);
    },
    appendEntry(type: string, data: unknown) {
      entries.push({ type: "custom", customType: type, data });
    },
    sendMessage() {},
  };
  extension(firstPi);
  const ctx = { cwd: "/tmp", isIdle: () => true, sessionManager: { getEntries: () => entries } };
  await firstEvents.get("session_start")({}, ctx);
  await tool.execute(
    "1",
    { action: "create", name: "x", command: "sh" },
    undefined,
    undefined,
    ctx,
  );
  await tool.execute(
    "2",
    { action: "call", name: "x", command: "sleep 10", timeoutMs: 10_000 },
    undefined,
    undefined,
    ctx,
  );
  await tool.execute(
    "3",
    { action: "watch", name: "x", pattern: "READY" },
    undefined,
    undefined,
    ctx,
  );
  await firstEvents.get("session_shutdown")({}, ctx);

  let restoredTool: any;
  const secondEvents = new Map<string, any>();
  const secondPi: any = {
    registerTool(value: any) {
      restoredTool = value;
    },
    on(name: string, handler: any) {
      secondEvents.set(name, handler);
    },
    appendEntry(type: string, data: unknown) {
      entries.push({ type: "custom", customType: type, data });
    },
    sendMessage() {},
  };
  extension(secondPi);
  await secondEvents.get("session_start")({}, ctx);
  const listed = await restoredTool.execute("4", { action: "list" }, undefined, undefined, ctx);
  assert.equal(listed.details[0].pendingCalls, 1);
  assert.equal(listed.details[0].watches, 1);
  await secondEvents.get("session_shutdown")({}, ctx);
  globalThis.setInterval = originalSetInterval;
});
