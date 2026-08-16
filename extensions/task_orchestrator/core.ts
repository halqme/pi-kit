import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export type TaskStatus = "created" | "running" | "stopped" | "completed";

export type Task = {
  id: string;
  request: string;
  repoRoot: string;
  worktreePath: string;
  branch: string;
  baseSha: string;
  queenSession?: string;
  status: TaskStatus;
};

export type TaskStatusView = {
  task: Task;
  queenAlive: boolean;
  dirty: boolean | null;
};

export interface WorktreeManager {
  repoRoot(cwd: string): Promise<string>;
  head(repoRoot: string): Promise<string>;
  status(worktreePath: string): Promise<string>;
  create(repoRoot: string, worktreePath: string, branch: string, baseSha: string): Promise<void>;
  exists(worktreePath: string): Promise<boolean>;
  remove(repoRoot: string, worktreePath: string): Promise<void>;
}

export interface QueenManager {
  launch(task: Task, mode: "start" | "resume"): Promise<string>;
  isAlive(session: string): Promise<boolean>;
  close(session: string): Promise<void>;
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === "created" || value === "running" || value === "stopped" || value === "completed";
}

function isTask(value: unknown): value is Task {
  if (!value || typeof value !== "object") return false;
  const task = value as Record<string, unknown>;
  return (
    typeof task.id === "string" &&
    typeof task.request === "string" &&
    typeof task.repoRoot === "string" &&
    typeof task.worktreePath === "string" &&
    typeof task.branch === "string" &&
    typeof task.baseSha === "string" &&
    (task.queenSession === undefined || typeof task.queenSession === "string") &&
    isTaskStatus(task.status)
  );
}

function assertTaskId(taskId: string): void {
  if (!/^task-[a-z0-9-]+$/.test(taskId)) throw new Error(`Invalid task id: ${taskId}`);
}

export class TaskStore {
  constructor(private readonly root: string) {}

  private path(taskId: string): string {
    assertTaskId(taskId);
    return join(this.root, `${taskId}.json`);
  }

  async create(task: Task): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.path(task.id), `${JSON.stringify(task, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  }

  async get(taskId: string): Promise<Task> {
    const path = this.path(taskId);
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isTask(parsed)) throw new Error(`Invalid task record: ${path}`);
    return parsed;
  }

  async update(task: Task): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const path = this.path(task.id);
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(task, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  }

  async list(): Promise<Task[]> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const tasks = await Promise.all(
      names
        .filter((name) => name.startsWith("task-") && name.endsWith(".json"))
        .map((name) => this.get(name.slice(0, -".json".length))),
    );
    return tasks.sort((left, right) => left.id.localeCompare(right.id));
  }

  async delete(taskId: string): Promise<void> {
    await unlink(this.path(taskId));
  }
}

function safeRepoName(repoRoot: string): string {
  const name = basename(repoRoot).replace(/[^A-Za-z0-9._-]/g, "_") || "repo";
  const hash = createHash("sha256").update(resolve(repoRoot)).digest("hex").slice(0, 8);
  return `${name}-${hash}`;
}

export function taskWorktreePath(worktreesRoot: string, repoRoot: string, taskId: string): string {
  assertTaskId(taskId);
  return join(worktreesRoot, safeRepoName(repoRoot), taskId);
}

export function buildQueenPrompt(task: Task, mode: "start" | "resume"): string {
  const opening =
    mode === "resume"
      ? "Resume this durable task from the existing worktree state. Inspect what is already present before changing anything."
      : "Execute this durable task in the dedicated worktree you were started in.";
  return `${opening}

You are the Queen for ${task.id}. You own the task's semantic decisions, planning, implementation, and verification.

Runtime boundaries:
- Work directly in the current task worktree: ${task.worktreePath}
- Do not submit another top-level task from this worktree.
- Do not create, remove, move, or prune Git worktrees. Task Runtime owns worktree lifecycle.
- Worker worktrees and editing-worker delegation are outside the current MVP. Do not introduce them implicitly.
- Use grill, planner, runner, loop, agent_team, astrolabe, bm25_search, browser_inspector, and other available tools only as the task requires.
- Do not merge, rebase, stash, reset, clean, or commit unless the user request itself requires that Git operation.
- When the requested work is complete, run verification proportionate to the change, then call task_orchestrator with action=complete and taskId=${task.id}.
- If blocked, leave the task incomplete and report the blocker instead of broadening scope.

User request:
${task.request}`;
}

export class TaskRuntime {
  constructor(
    private readonly store: TaskStore,
    private readonly worktrees: WorktreeManager,
    private readonly queens: QueenManager,
    private readonly worktreesRoot: string,
    private readonly idFactory: () => string = () => `task-${randomUUID().slice(0, 8)}`,
  ) {}

  async submit(request: string, cwd: string): Promise<Task> {
    const normalizedRequest = request.trim();
    if (!normalizedRequest) throw new Error("request is required");

    const repoRoot = resolve(await this.worktrees.repoRoot(cwd));
    for (const existing of await this.store.list()) {
      if (resolve(existing.worktreePath) === repoRoot)
        throw new Error(`Cannot submit a nested task from managed worktree ${existing.id}`);
    }

    const dirty = await this.worktrees.status(repoRoot);
    if (dirty.trim()) throw new Error("Source worktree is dirty; task submission requires a clean worktree");

    const id = this.idFactory();
    assertTaskId(id);
    const baseSha = await this.worktrees.head(repoRoot);
    const task: Task = {
      id,
      request: normalizedRequest,
      repoRoot,
      worktreePath: taskWorktreePath(this.worktreesRoot, repoRoot, id),
      branch: `pi/task/${id}`,
      baseSha,
      status: "created",
    };

    await this.worktrees.create(task.repoRoot, task.worktreePath, task.branch, task.baseSha);
    try {
      await this.store.create(task);
    } catch (error) {
      await this.worktrees.remove(task.repoRoot, task.worktreePath).catch(() => {});
      throw error;
    }

    try {
      const queenSession = await this.queens.launch(task, "start");
      const running: Task = { ...task, queenSession, status: "running" };
      await this.store.update(running);
      return running;
    } catch (error) {
      const stopped: Task = { ...task, status: "stopped" };
      await this.store.update(stopped);
      throw new Error(`Queen launch failed for ${task.id}; task worktree was retained`, { cause: error });
    }
  }

  async status(taskId: string): Promise<TaskStatusView> {
    let task = await this.store.get(taskId);
    const queenAlive = task.queenSession ? await this.queens.isAlive(task.queenSession) : false;
    if (task.status === "running" && !queenAlive) {
      task = { ...task, status: "stopped" };
      await this.store.update(task);
    }
    const exists = await this.worktrees.exists(task.worktreePath);
    const dirty = exists ? Boolean((await this.worktrees.status(task.worktreePath)).trim()) : null;
    return { task, queenAlive, dirty };
  }

  async list(): Promise<Task[]> {
    return this.store.list();
  }

  async resume(taskId: string): Promise<Task> {
    const task = await this.store.get(taskId);
    if (task.status === "completed") throw new Error(`Task is already completed: ${taskId}`);
    if (!(await this.worktrees.exists(task.worktreePath)))
      throw new Error(`Task worktree is missing: ${task.worktreePath}`);
    if (task.queenSession && (await this.queens.isAlive(task.queenSession)))
      throw new Error(`Queen is still running for ${taskId}`);

    try {
      const queenSession = await this.queens.launch(task, "resume");
      const running: Task = { ...task, queenSession, status: "running" };
      await this.store.update(running);
      return running;
    } catch (error) {
      const stopped: Task = { ...task, status: "stopped" };
      await this.store.update(stopped);
      throw new Error(`Queen resume failed for ${task.id}`, { cause: error });
    }
  }

  async complete(taskId: string, cwd: string): Promise<Task> {
    const task = await this.store.get(taskId);
    const currentRoot = resolve(await this.worktrees.repoRoot(cwd));
    if (currentRoot !== resolve(task.worktreePath))
      throw new Error(`Task ${taskId} can only be completed from its own worktree`);
    const completed: Task = { ...task, status: "completed" };
    await this.store.update(completed);
    return completed;
  }

  async cleanup(taskId: string): Promise<{ taskId: string; branch: string; status: "cleaned" }> {
    let task = await this.store.get(taskId);
    if (!(await this.worktrees.exists(task.worktreePath)))
      throw new Error(`Task worktree is missing; keeping task record: ${task.worktreePath}`);

    const queenAlive = task.queenSession ? await this.queens.isAlive(task.queenSession) : false;
    if (task.status === "running" && queenAlive)
      throw new Error(`Queen is still running for ${taskId}; refusing cleanup`);
    if (task.status === "running" && !queenAlive) {
      task = { ...task, status: "stopped" };
      await this.store.update(task);
    }
    if (queenAlive) {
      if (task.status !== "completed")
        throw new Error(`Queen session is alive for incomplete task ${taskId}; refusing cleanup`);
      await this.queens.close(task.queenSession!);
    }

    if ((await this.worktrees.status(task.worktreePath)).trim())
      throw new Error(`Task worktree is dirty; keeping it: ${task.worktreePath}`);

    await this.worktrees.remove(task.repoRoot, task.worktreePath);
    await this.store.delete(task.id);
    return { taskId: task.id, branch: task.branch, status: "cleaned" };
  }
}
