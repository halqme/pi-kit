import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import loopExtension from "./index.ts";
import { loopController } from "./control.ts";

test("loop follows up only while the task remains unfinished", async () => {
  let tool: any;
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
  await assert.rejects(
    () => tool.execute("invalid", { action: "start", task: "   " }, undefined, undefined, ctx),
    /task is required for start/,
  );

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
  assert.match(sent[0] ?? "", /No completion report/);
  assert.match(sent[0] ?? "", /finish the change/);

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
  assert.match(sent[1] ?? "", /tests still running/);

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

test("failed model runs do not consume loop turns or queued reports", async () => {
  let tool: any;
  let end: any;
  let startSession: any;
  const sent: string[] = [];
  const entries: any[] = [];
  const pi = {
    registerTool(value: any) {
      tool = value;
    },
    on(name: string, handler: any) {
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
  await tool.execute("id", { action: "start", task: "recover", maxTurns: 4 });
  await tool.execute("id", {
    action: "report",
    status: "continue",
    summary: "keep this report across retry",
  });

  await end(
    {
      messages: [
        { role: "assistant", stopReason: "error", errorMessage: "connection timeout", content: [] },
      ],
    },
    ctx,
  );
  assert.equal(sent.length, 0, "failed model runs must not enqueue a continuation");
  assert.equal(loopController.snapshot()?.turns, 0, "failed model runs must not consume maxTurns");
  assert.equal(
    loopController.snapshot()?.pendingReport?.summary,
    "keep this report across retry",
    "a retry must preserve the report for the eventual successful turn end",
  );

  await end({ messages: [{ role: "assistant", stopReason: "stop", content: [] }] }, ctx);
  assert.equal(sent.length, 1);
  assert.match(sent[0] ?? "", /keep this report across retry/);
  assert.equal(loopController.snapshot()?.turns, 1);
  assert.equal(loopController.snapshot()?.pendingReport, undefined);
});

test("loop exhausts instead of continuing forever", async () => {
  let tool: any;
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
  await tool.execute("id", { action: "start", task: "bounded", maxTurns: 1 });
  await end({}, ctx);
  assert.equal(sent.length, 0);
  assert.equal(messages.length, 1);
  assert.equal(loopController.snapshot()?.status, "exhausted");
});
