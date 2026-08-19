import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { inspectProcess, listProcesses, startBackgroundProcess } from "./core.ts";
import backgroundProcessExtension from "./index.ts";

test("session restore notifies and acknowledges an unchecked process once", async (t) => {
  const sessionDir = await mkdtemp(join(tmpdir(), "pi-background-session-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const root = join(sessionDir, "session.background-process");
  const started = await startBackgroundProcess({
    taskRoot: root,
    ownerSessionId: "session",
    cwd: sessionDir,
    spec: { type: "shell", command: "true" },
  });
  for (let index = 0; index < 100; index++) {
    if ((await inspectProcess(started.taskDir)).phase === "unchecked") break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  const events = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<unknown>>();
  const messages: Array<{ message: unknown; options: unknown }> = [];
  const pi = {
    registerTool() {},
    on(name: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown>) {
      events.set(name, handler);
    },
    sendMessage(message: unknown, options: unknown) {
      messages.push({ message, options });
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: sessionDir,
    isIdle: () => true,
    ui: { setStatus() {} },
    sessionManager: {
      getSessionDir: () => sessionDir,
      getSessionId: () => "session",
      getSessionFile: () => join(sessionDir, "session.jsonl"),
    },
  } as unknown as ExtensionContext;

  backgroundProcessExtension(pi);
  await events.get("session_start")?.({ type: "session_start", reason: "resume" }, ctx);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0]?.options, { triggerTurn: true, deliverAs: "followUp" });
  assert.equal((await inspectProcess(started.taskDir)).phase, "completed");
  await events.get("session_compact")?.({ type: "session_compact" }, ctx);
  assert.equal(messages.length, 1);
  await events.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, ctx);
});

test("start_many reports mixed failures without requiring a retry", async (t) => {
  const sessionDir = await mkdtemp(join(tmpdir(), "pi-background-session-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const root = join(sessionDir, "session.background-process");
  let tool: { execute: (...args: unknown[]) => Promise<unknown> } | undefined;
  const pi = {
    registerTool(candidate: { execute: (...args: unknown[]) => Promise<unknown> }) {
      tool = candidate;
    },
    on() {},
    sendMessage() {},
  } as unknown as ExtensionAPI;
  const ctx = {
    cwd: sessionDir,
    isIdle: () => true,
    ui: { setStatus() {} },
    sessionManager: {
      getSessionDir: () => sessionDir,
      getSessionId: () => "session",
      getSessionFile: () => join(sessionDir, "session.jsonl"),
    },
  } as unknown as ExtensionContext;

  backgroundProcessExtension(pi);
  const registeredTool = tool;
  assert.ok(registeredTool);
  const result = (await registeredTool.execute(
    "tool-call",
    {
      action: "start_many",
      processes: [
        { command: "printf one", label: "one" },
        { command: "   ", label: "invalid" },
        { command: "printf two", label: "two" },
      ],
    },
    undefined,
    undefined,
    ctx,
  )) as {
    content: Array<{ text?: string }>;
    details: {
      status: "started" | "partial" | "failed";
      started: Array<{ taskDir: string }>;
      failed: Array<{ index: number; error: string }>;
    };
    isError?: boolean;
  };

  assert.equal(result.isError, undefined);
  assert.equal(result.details.status, "partial");
  assert.match(String(result.content[0]?.text), /Batch status: partial/);
  assert.match(String(result.content[0]?.text), /Launch acknowledged/);
  assert.match(String(result.content[0]?.text), /Failed 1 process/);
  assert.match(String(result.content[0]?.text), /1: .*command is required/);
  assert.equal(result.details.started.length, 2);
  assert.equal(result.details.failed.length, 1);
  assert.equal(result.details.failed[0]?.index, 1);
  assert.match(result.details.failed[0]?.error ?? "", /command is required/);

  const launched = await listProcesses(root, { includeCompleted: true });
  assert.equal(launched.length, 2);
  assert.deepEqual(
    new Set(launched.map((process) => process.request.label)),
    new Set(["one", "two"]),
  );
  await Promise.all(
    result.details.started.map(async (process) => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const snapshot = await inspectProcess(process.taskDir);
        if (snapshot.phase === "unchecked" || snapshot.phase === "completed") {
          assert.ok(snapshot.request.label === "one" || snapshot.request.label === "two");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.fail(`Timed out waiting for ${process.taskDir} to complete`);
    }),
  );

  const invalid = (await registeredTool.execute(
    "tool-call",
    { action: "start_many", processes: [{ command: "   " }] },
    undefined,
    undefined,
    ctx,
  )) as {
    content: Array<{ text?: string }>;
    details: {
      status: "started" | "partial" | "failed";
      started: unknown[];
      failed: Array<{ index: number; error: string }>;
    };
  };
  assert.equal(invalid.details.status, "failed");
  assert.match(String(invalid.content[0]?.text), /Batch status: failed/);
  assert.deepEqual(invalid.details.started, []);
  assert.equal(invalid.details.failed[0]?.index, 0);
  assert.equal((await listProcesses(root, { includeCompleted: true })).length, 2);
});
