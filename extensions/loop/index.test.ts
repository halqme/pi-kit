import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import loopExtension from "./index.ts";
import { loopController } from "./control.ts";

test("loop follows up only while the task remains unfinished", async () => {
  let tool: any;
  let before: any;
  let end: any;
  let startSession: any;
  const sent: string[] = [];
  const messages: unknown[] = [];
  const entries: any[] = [];
  const pi = {
    registerTool(value: any) {
      tool = value;
    },
    on(name: string, handler: any) {
      if (name === "before_agent_start") before = handler;
      if (name === "agent_end") end = handler;
      if (name === "session_start") startSession = handler;
    },
    appendEntry(type: string, data: unknown) {
      entries.push({ type: "custom", customType: type, data });
    },
    sendUserMessage(message: string) {
      sent.push(message);
    },
    sendMessage(message: unknown) {
      messages.push(message);
    },
  } as unknown as ExtensionAPI;

  loopExtension(pi);
  const ctx = { sessionManager: { getEntries: () => entries } } as any;
  await startSession({}, ctx);
  await before({}, ctx);

  const started = await tool.execute(
    "id",
    { action: "start", task: "finish the change", maxTurns: 4 },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(started.details.status, "active");
  assert.equal(sent.length, 0, "start must not inject an immediate follow-up");

  await end({}, ctx);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /No completion report/);
  assert.match(sent[0], /finish the change/);

  await before({}, ctx);
  const continued = await tool.execute(
    "id",
    { action: "report", status: "continue", summary: "tests still running" },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(continued.details.status, "active");
  await end({}, ctx);
  assert.equal(sent.length, 2);
  assert.match(sent[1], /tests still running/);

  await before({}, ctx);
  const done = await tool.execute(
    "id",
    { action: "report", status: "done", summary: "verified" },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(done.details.status, "done");
  await end({}, ctx);
  assert.equal(sent.length, 2, "completed loops must not send another follow-up");
  assert.equal(messages.length, 0);
  assert.equal(loopController.snapshot()?.lastSummary, "verified");
});

test("loop ignores duplicate agent_end events within one agent turn", async () => {
  let tool: any;
  let before: any;
  let end: any;
  let startSession: any;
  const sent: string[] = [];
  const entries: any[] = [];
  const pi = {
    registerTool(value: any) {
      tool = value;
    },
    on(name: string, handler: any) {
      if (name === "before_agent_start") before = handler;
      if (name === "agent_end") end = handler;
      if (name === "session_start") startSession = handler;
    },
    appendEntry(type: string, data: unknown) {
      entries.push({ type: "custom", customType: type, data });
    },
    sendUserMessage(message: string) {
      sent.push(message);
    },
    sendMessage() {},
  } as unknown as ExtensionAPI;

  loopExtension(pi);
  const ctx = { sessionManager: { getEntries: () => entries } } as any;
  await startSession({}, ctx);
  await before({}, ctx);
  await tool.execute("id", { action: "start", task: "dedupe", maxTurns: 4 });
  await tool.execute("id", { action: "report", status: "continue", summary: "first turn" });

  await end({}, ctx);
  await end({}, ctx);
  assert.equal(sent.length, 1, "duplicate agent_end must not send a second follow-up");
  assert.equal(loopController.snapshot()?.turns, 1, "duplicate agent_end must not consume a turn");
  assert.match(sent[0], /first turn/);

  await before({}, ctx);
  await tool.execute("id", { action: "report", status: "continue", summary: "second turn" });
  await end({}, ctx);
  assert.equal(sent.length, 2, "the next agent turn may send its own follow-up");
  assert.equal(loopController.snapshot()?.turns, 2);
  assert.match(sent[1], /second turn/);
});

test("loop exhausts instead of continuing forever", async () => {
  let tool: any;
  let before: any;
  let end: any;
  let startSession: any;
  const sent: string[] = [];
  const messages: unknown[] = [];
  const entries: any[] = [];
  const pi: any = {
    registerTool(value: any) {
      tool = value;
    },
    on(name: string, handler: any) {
      if (name === "before_agent_start") before = handler;
      if (name === "agent_end") end = handler;
      if (name === "session_start") startSession = handler;
    },
    appendEntry(type: string, data: unknown) {
      entries.push({ type: "custom", customType: type, data });
    },
    sendUserMessage(message: string) {
      sent.push(message);
    },
    sendMessage(message: unknown) {
      messages.push(message);
    },
  };
  loopExtension(pi);
  const ctx = { sessionManager: { getEntries: () => entries } };
  await startSession({}, ctx);
  await before({}, ctx);
  await tool.execute("id", { action: "start", task: "bounded", maxTurns: 1 });
  await end({}, ctx);
  assert.equal(sent.length, 0);
  assert.equal(messages.length, 1);
  assert.equal(loopController.snapshot()?.status, "exhausted");
});
