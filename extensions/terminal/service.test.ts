import { describe, expect, test } from "bun:test";
import { TerminalSessionService } from "./service.ts";

describe("TerminalSessionService", () => {
  test("creates a tmux session in the requested cwd and starts the command", async () => {
    const calls: string[][] = [];
    const service = new TerminalSessionService(async (args) => {
      calls.push(args);
    });

    const created = await service.create("pi --name queen 'do work'", "/tmp/task-worktree");

    expect(created.cwd).toBe("/tmp/task-worktree");
    expect(created.session.startsWith("pi-terminal-")).toBe(true);
    expect(calls).toEqual([
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

    await expect(service.create("pi", "/tmp/task-worktree")).rejects.toThrow("send failed");

    const session = calls[0]?.[4];
    expect(session?.startsWith("pi-terminal-")).toBe(true);
    expect(calls.at(-1)).toEqual(["kill-session", "-t", session!]);
  });

  test("reports liveness and closes by tmux session id", async () => {
    const calls: string[][] = [];
    const service = new TerminalSessionService(async (args) => {
      calls.push(args);
      if (args[0] === "has-session" && args[2] === "dead") throw new Error("missing");
    });

    expect(await service.isAlive("alive")).toBe(true);
    expect(await service.isAlive("dead")).toBe(false);
    await service.close("alive");

    expect(calls).toEqual([
      ["has-session", "-t", "alive"],
      ["has-session", "-t", "dead"],
      ["kill-session", "-t", "alive"],
    ]);
  });
});
