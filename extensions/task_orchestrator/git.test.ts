import { describe, expect, test } from "bun:test";
import { GitWorktreeManager } from "./git.ts";

type ExecResult = { stdout: string; stderr: string; code: number; killed: boolean };

describe("GitWorktreeManager", () => {
  test("uses argument-based git worktree operations without stash, clean, or force", async () => {
    const calls: Array<{ command: string; args: string[]; cwd: string | undefined }> = [];
    const responses: ExecResult[] = [
      { stdout: "/repo\n", stderr: "", code: 0, killed: false },
      { stdout: "abc123\n", stderr: "", code: 0, killed: false },
      { stdout: "", stderr: "", code: 0, killed: false },
      { stdout: "", stderr: "", code: 0, killed: false },
    ];
    const manager = new GitWorktreeManager({
      async exec(command, args, options) {
        calls.push({ command, args, cwd: options?.cwd });
        return responses.shift()!;
      },
    });

    expect(await manager.repoRoot("/repo/subdir")).toBe("/repo");
    expect(await manager.head("/repo")).toBe("abc123");
    expect(await manager.status("/repo")).toBe("");
    await manager.create("/repo", "/tasks/task-test", "pi/task/task-test", "abc123");

    expect(calls).toEqual([
      { command: "git", args: ["rev-parse", "--show-toplevel"], cwd: "/repo/subdir" },
      { command: "git", args: ["rev-parse", "HEAD"], cwd: "/repo" },
      { command: "git", args: ["status", "--porcelain"], cwd: "/repo" },
      {
        command: "git",
        args: ["worktree", "add", "-b", "pi/task/task-test", "/tasks/task-test", "abc123"],
        cwd: "/repo",
      },
    ]);
  });

  test("does not force worktree removal", async () => {
    const calls: string[][] = [];
    const manager = new GitWorktreeManager({
      async exec(_command, args) {
        calls.push(args);
        return { stdout: "", stderr: "", code: 0, killed: false };
      },
    });

    await manager.remove("/repo", "/tasks/task-test");

    expect(calls).toEqual([["worktree", "remove", "/tasks/task-test"]]);
  });

  test("propagates Git failures with stderr", async () => {
    const manager = new GitWorktreeManager({
      async exec() {
        return { stdout: "", stderr: "fatal: not a git repository\n", code: 128, killed: false };
      },
    });

    await expect(manager.repoRoot("/tmp")).rejects.toThrow("fatal: not a git repository");
  });
});
