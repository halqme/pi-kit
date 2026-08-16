import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  TaskRuntime,
  TaskStore,
  type QueenManager,
  type Task,
  type WorktreeManager,
} from "./core.ts";

class FakeWorktrees implements WorktreeManager {
  readonly existing = new Set<string>();
  readonly dirty = new Map<string, string>();
  readonly created: Array<{ repoRoot: string; path: string; branch: string; baseSha: string }> = [];
  readonly removed: string[] = [];

  constructor(readonly sourceRoot: string) {
    this.existing.add(resolve(sourceRoot));
    this.dirty.set(resolve(sourceRoot), "");
  }

  async repoRoot(cwd: string): Promise<string> {
    const target = resolve(cwd);
    const worktree = [...this.existing]
      .filter((path) => path !== resolve(this.sourceRoot))
      .find((path) => target === path || target.startsWith(`${path}/`));
    return worktree ?? resolve(this.sourceRoot);
  }

  async head(): Promise<string> {
    return "abc123";
  }

  async status(worktreePath: string): Promise<string> {
    return this.dirty.get(resolve(worktreePath)) ?? "";
  }

  async create(repoRoot: string, worktreePath: string, branch: string, baseSha: string): Promise<void> {
    const path = resolve(worktreePath);
    this.created.push({ repoRoot, path, branch, baseSha });
    this.existing.add(path);
    this.dirty.set(path, "");
  }

  async exists(worktreePath: string): Promise<boolean> {
    return this.existing.has(resolve(worktreePath));
  }

  async remove(_repoRoot: string, worktreePath: string): Promise<void> {
    const path = resolve(worktreePath);
    this.removed.push(path);
    this.existing.delete(path);
    this.dirty.delete(path);
  }
}

class FakeQueens implements QueenManager {
  readonly launched: Array<{ taskId: string; worktreePath: string; mode: "start" | "resume" }> = [];
  readonly alive = new Map<string, boolean>();
  readonly closed: string[] = [];
  private next = 1;

  async launch(task: Task, mode: "start" | "resume"): Promise<string> {
    const session = `queen-${this.next++}`;
    this.launched.push({ taskId: task.id, worktreePath: task.worktreePath, mode });
    this.alive.set(session, true);
    return session;
  }

  async isAlive(session: string): Promise<boolean> {
    return this.alive.get(session) ?? false;
  }

  async close(session: string): Promise<void> {
    this.closed.push(session);
    this.alive.set(session, false);
  }
}

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-task-runtime-"));
  temporaryRoots.push(root);
  const repoRoot = join(root, "repo");
  const worktrees = new FakeWorktrees(repoRoot);
  const queens = new FakeQueens();
  const store = new TaskStore(join(root, "store"));
  const runtime = new TaskRuntime(store, worktrees, queens, join(root, "worktrees"), () => "task-test");
  return { root, repoRoot, worktrees, queens, store, runtime };
}

describe("TaskRuntime", () => {
  test("submits a clean repository into a dedicated worktree and Queen", async () => {
    const { repoRoot, runtime, worktrees, queens, store } = await fixture();

    const task = await runtime.submit("Implement the requested change", repoRoot);

    expect(task).toMatchObject({
      id: "task-test",
      request: "Implement the requested change",
      repoRoot: resolve(repoRoot),
      branch: "pi/task/task-test",
      baseSha: "abc123",
      queenSession: "queen-1",
      status: "running",
    });
    expect(worktrees.created).toEqual([
      {
        repoRoot: resolve(repoRoot),
        path: resolve(task.worktreePath),
        branch: "pi/task/task-test",
        baseSha: "abc123",
      },
    ]);
    expect(queens.launched).toEqual([
      { taskId: "task-test", worktreePath: task.worktreePath, mode: "start" },
    ]);
    expect(await store.get("task-test")).toEqual(task);
  });

  test("refuses submit when the source worktree is dirty", async () => {
    const { repoRoot, runtime, worktrees } = await fixture();
    worktrees.dirty.set(resolve(repoRoot), " M src/index.ts");

    await expect(runtime.submit("Change it", repoRoot)).rejects.toThrow("Source worktree is dirty");
    expect(worktrees.created).toHaveLength(0);
  });

  test("refuses nested top-level submit from a managed task worktree", async () => {
    const { repoRoot, runtime, worktrees } = await fixture();
    const task = await runtime.submit("First task", repoRoot);
    worktrees.dirty.set(resolve(task.worktreePath), "");

    await expect(runtime.submit("Nested task", task.worktreePath)).rejects.toThrow(
      "Cannot submit a nested task from managed worktree task-test",
    );
  });

  test("marks a running task stopped when its Queen is gone", async () => {
    const { repoRoot, runtime, queens, worktrees, store } = await fixture();
    const task = await runtime.submit("Change it", repoRoot);
    queens.alive.set(task.queenSession!, false);
    worktrees.dirty.set(resolve(task.worktreePath), " M src/index.ts");

    const status = await runtime.status(task.id);

    expect(status.queenAlive).toBe(false);
    expect(status.dirty).toBe(true);
    expect(status.task.status).toBe("stopped");
    expect((await store.get(task.id)).status).toBe("stopped");
  });

  test("resumes a stopped task in the same worktree", async () => {
    const { repoRoot, runtime, queens } = await fixture();
    const task = await runtime.submit("Change it", repoRoot);
    queens.alive.set(task.queenSession!, false);
    await runtime.status(task.id);

    const resumed = await runtime.resume(task.id);

    expect(resumed.worktreePath).toBe(task.worktreePath);
    expect(resumed.queenSession).toBe("queen-2");
    expect(resumed.status).toBe("running");
    expect(queens.launched.at(-1)).toEqual({
      taskId: task.id,
      worktreePath: task.worktreePath,
      mode: "resume",
    });
  });

  test("allows complete only from the task's own worktree", async () => {
    const { repoRoot, runtime } = await fixture();
    const task = await runtime.submit("Change it", repoRoot);

    await expect(runtime.complete(task.id, repoRoot)).rejects.toThrow("only be completed from its own worktree");
    expect((await runtime.complete(task.id, task.worktreePath)).status).toBe("completed");
  });

  test("keeps dirty worktrees during cleanup", async () => {
    const { repoRoot, runtime, worktrees } = await fixture();
    const task = await runtime.submit("Change it", repoRoot);
    await runtime.complete(task.id, task.worktreePath);
    worktrees.dirty.set(resolve(task.worktreePath), " M src/index.ts");

    await expect(runtime.cleanup(task.id)).rejects.toThrow("Task worktree is dirty; keeping it");
    expect(worktrees.existing.has(resolve(task.worktreePath))).toBe(true);
  });

  test("cleans a completed clean worktree while retaining its task branch", async () => {
    const { repoRoot, runtime, worktrees, queens, store } = await fixture();
    const task = await runtime.submit("Change it", repoRoot);
    await runtime.complete(task.id, task.worktreePath);

    const cleaned = await runtime.cleanup(task.id);

    expect(cleaned).toEqual({
      taskId: task.id,
      branch: "pi/task/task-test",
      status: "cleaned",
    });
    expect(worktrees.removed).toEqual([resolve(task.worktreePath)]);
    expect(queens.closed).toEqual([task.queenSession]);
    await expect(store.get(task.id)).rejects.toThrow();
  });
});
