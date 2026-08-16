import assert from "node:assert/strict";
import test from "node:test";
import { TerminalSessionService } from "./service.ts";

test("creates a process-bound tmux session in the requested cwd", async () => {
  const calls: string[][] = [];
  const service = new TerminalSessionService(async (args) => {
    calls.push(args);
  });

  const command = "pi --name queen 'do work'";
  const created = await service.create(command, "/tmp/task-worktree");

  assert.equal(created.cwd, "/tmp/task-worktree");
  assert.equal(created.session.startsWith("pi-terminal-"), true);
  assert.deepEqual(calls, [
    ["new-session", "-d", "-s", created.session, "-c", "/tmp/task-worktree", command],
  ]);
});

test("propagates session creation failure", async () => {
  const service = new TerminalSessionService(async () => {
    throw new Error("create failed");
  });

  await assert.rejects(service.create("pi", "/tmp/task-worktree"), /create failed/);
});

test("reports liveness and closes by tmux session id", async () => {
  const calls: string[][] = [];
  const service = new TerminalSessionService(async (args) => {
    calls.push(args);
    if (args[0] === "has-session" && args[2] === "dead") throw new Error("missing");
  });

  assert.equal(await service.isAlive("alive"), true);
  assert.equal(await service.isAlive("dead"), false);
  await service.close("alive");

  assert.deepEqual(calls, [
    ["has-session", "-t", "alive"],
    ["has-session", "-t", "dead"],
    ["kill-session", "-t", "alive"],
  ]);
});
