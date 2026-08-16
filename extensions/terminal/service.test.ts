import assert from "node:assert/strict";
import test from "node:test";
import { TerminalSessionService } from "./service.ts";

test("creates a tmux session in the requested cwd and starts the command", async () => {
  const calls: string[][] = [];
  const service = new TerminalSessionService(async (args) => {
    calls.push(args);
  });

  const created = await service.create("pi --name queen 'do work'", "/tmp/task-worktree");

  assert.equal(created.cwd, "/tmp/task-worktree");
  assert.equal(created.session.startsWith("pi-terminal-"), true);
  assert.deepEqual(calls, [
    ["new-session", "-d", "-s", created.session, "-c", "/tmp/task-worktree"],
    ["send-keys", "-t", created.session, "-l", "pi --name queen 'do work'"],
    ["send-keys", "-t", created.session, "Enter"],
  ]);
});

test("removes a partially created session when command injection fails", async () => {
  const calls: string[][] = [];
  let call = 0;
  const service = new TerminalSessionService(async (args) => {
    calls.push(args);
    call++;
    if (call === 2) throw new Error("send failed");
  });

  await assert.rejects(service.create("pi", "/tmp/task-worktree"), /send failed/);

  const session = calls[0]?.[4];
  assert.equal(session?.startsWith("pi-terminal-"), true);
  assert.deepEqual(calls.at(-1), ["kill-session", "-t", session!]);
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
