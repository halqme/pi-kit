import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { jsonResult } from "./shared.ts";

interface DelegateMetadata {
  version: 1;
  id: string;
  task: string;
  acceptance: string[];
  repoRoot: string;
  worktree: string;
  branch: string;
  baseRef: string;
  pid: number;
  stdoutPath: string;
  stderrPath: string;
  status: "running" | "finished" | "stopped";
  exitCode?: number | null;
  exitSignal?: string | null;
  createdAt: string;
  updatedAt: string;
}

async function runCommand(
  cwd: string,
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      command,
      args,
      { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(`${command} ${args.join(" ")} failed: ${stderr.trim() || error.message}`),
          );
          return;
        }
        resolvePromise({ stdout: stdout.trim(), stderr: stderr.trim() });
      },
    );
  });
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await runCommand(cwd, "git", args)).stdout;
}

async function repositoryInfo(cwd: string): Promise<{ root: string; commonDir: string }> {
  const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
  const common = await git(root, ["rev-parse", "--git-common-dir"]);
  return { root, commonDir: isAbsolute(common) ? common : resolve(root, common) };
}

function delegatePaths(commonDir: string, id: string) {
  const dir = join(commonDir, "pi-kit", "delegates");
  return {
    dir,
    metadata: join(dir, `${id}.json`),
    stdout: join(dir, `${id}.stdout.log`),
    stderr: join(dir, `${id}.stderr.log`),
  };
}

async function saveDelegate(path: string, metadata: DelegateMetadata): Promise<void> {
  metadata.updatedAt = new Date().toISOString();
  await writeFile(path, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

async function loadDelegate(commonDir: string, id: string): Promise<DelegateMetadata> {
  return JSON.parse(
    await readFile(delegatePaths(commonDir, id).metadata, "utf8"),
  ) as DelegateMetadata;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function tail(path: string, maximum = 8_000): Promise<string> {
  try {
    const text = await readFile(path, "utf8");
    return text.length <= maximum ? text : text.slice(text.length - maximum);
  } catch {
    return "";
  }
}

async function removeWorktree(metadata: DelegateMetadata): Promise<boolean> {
  try {
    await git(metadata.repoRoot, ["worktree", "remove", "--force", metadata.worktree]);
    return false;
  } catch (removeError) {
    await rm(metadata.worktree, { recursive: true, force: true });
    await git(metadata.repoRoot, ["worktree", "prune"]);
    const listed = await git(metadata.repoRoot, ["worktree", "list", "--porcelain"]);
    if (listed.split("\n").some((line) => line === `worktree ${metadata.worktree}`)) {
      throw removeError;
    }
    return true;
  }
}

async function removeEmptyParents(path: string, levels: number): Promise<void> {
  let current = dirname(path);
  for (let index = 0; index < levels; index += 1) {
    try {
      await rmdir(current);
    } catch {
      return;
    }
    current = dirname(current);
  }
}

export function registerDelegate(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "delegate",
    label: "Delegate",
    description:
      "Run a child Pi in an isolated git worktree and branch. Delegation is for self-contained work with explicit acceptance criteria; the parent remains responsible for verification and integration. Worker completion is delivered automatically; do not poll status to wait for it.",
    promptGuidelines: [
      "Delegate only independently verifiable work. Keep unresolved architecture and product decisions with the parent.",
      "Each worker receives its own git worktree and branch; never share a mutating worktree between delegates.",
      "After starting a delegate, continue independent work and do not poll status to wait for completion. The worker will notify the parent when it exits; use status only for explicit progress or output inspection.",
      "A finished child process is not completion evidence. Inspect its branch and verify before integration.",
      "If isolated-worktree tooling is missing, follow applicable AGENTS.md and existing repository setup instructions, manifests, lockfiles, and scripts. Do not invent Pi-specific bootstrap configuration.",
      "Integrate accepted delegate output as one squashed change, then rerun verification in the parent worktree before committing.",
    ],
    parameters: Type.Union([
      Type.Object({
        action: Type.Literal("start"),
        task: Type.String({ minLength: 1 }),
        acceptance: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 20 })),
        baseRef: Type.Optional(Type.String({ minLength: 1 })),
      }),
      Type.Object({ action: Type.Literal("status"), id: Type.String({ minLength: 1 }) }),
      Type.Object({ action: Type.Literal("stop"), id: Type.String({ minLength: 1 }) }),
      Type.Object({ action: Type.Literal("integrate"), id: Type.String({ minLength: 1 }) }),
      Type.Object({
        action: Type.Literal("cleanup"),
        id: Type.String({ minLength: 1 }),
        deleteBranch: Type.Optional(Type.Boolean()),
      }),
    ]),
    async execute(_id, params, _signal, _update, ctx) {
      const repository = await repositoryInfo(ctx.cwd);

      if (params.action === "start") {
        const id = randomUUID().slice(0, 12);
        const baseRef = params.baseRef?.trim() || "HEAD";
        const branch = `pi/delegate/${id}`;
        const worktree = join(
          dirname(repository.root),
          ".pi-worktrees",
          basename(repository.root),
          id,
        );
        const paths = delegatePaths(repository.commonDir, id);
        await mkdir(paths.dir, { recursive: true });
        await mkdir(dirname(worktree), { recursive: true });
        await git(repository.root, ["worktree", "add", "-b", branch, worktree, baseRef]);

        const acceptance = (params.acceptance ?? []).map((item) => item.trim());
        const prompt = [
          "You are an isolated implementation worker.",
          `Task: ${params.task.trim()}`,
          acceptance.length > 0
            ? `Acceptance:\n${acceptance.map((item) => `- ${item}`).join("\n")}`
            : "",
          "Work only in this worktree. Keep the implementation scoped to the task.",
          "Read applicable AGENTS.md and existing repository setup instructions before changing code.",
          "If required tooling or dependencies are unavailable because this isolated worktree lacks ignored or generated state, infer and run the repository's existing setup/install command from its instructions, manifests, lockfiles, and scripts. Do not add Pi-specific bootstrap files or change project configuration just to prepare the worktree.",
          "Run relevant verification. Commit coherent changes on the current branch before finishing.",
          "Report changed files, checks run, failures, and remaining risks in your final response.",
        ]
          .filter(Boolean)
          .join("\n\n");

        const stdoutHandle = await open(paths.stdout, "a");
        const stderrHandle = await open(paths.stderr, "a");
        const child = spawn("pi", ["-ne", prompt], {
          cwd: worktree,
          detached: true,
          stdio: ["ignore", stdoutHandle.fd, stderrHandle.fd],
          env: process.env,
        });
        if (!child.pid) {
          await stdoutHandle.close();
          await stderrHandle.close();
          await git(repository.root, ["worktree", "remove", "--force", worktree]).catch(() => "");
          throw new Error("Child Pi did not return a process id.");
        }

        const now = new Date().toISOString();
        const metadata: DelegateMetadata = {
          version: 1,
          id,
          task: params.task.trim(),
          acceptance,
          repoRoot: repository.root,
          worktree,
          branch,
          baseRef,
          pid: child.pid,
          stdoutPath: paths.stdout,
          stderrPath: paths.stderr,
          status: "running",
          createdAt: now,
          updatedAt: now,
        };
        await saveDelegate(paths.metadata, metadata);
        let completionHandled = false;
        const handleCompletion = async (code: number | null, signal: NodeJS.Signals | null) => {
          if (completionHandled || metadata.status === "stopped") return;
          completionHandled = true;
          metadata.status = "finished";
          metadata.exitCode = code;
          metadata.exitSignal = signal;
          await saveDelegate(paths.metadata, metadata).catch(() => undefined);
          pi.sendMessage(
            {
              customType: "delegate-completion",
              content: [
                `[delegate] ${metadata.id} finished`,
                `Task: ${metadata.task}`,
                `Branch: ${metadata.branch}`,
                `Exit: ${code === null ? signal ?? "unknown" : code}`,
                "Completion received. Continue the pending task; inspect the delegate branch and verify before integration. Do not poll status unless progress or output is explicitly needed.",
              ].join("\n"),
              display: true,
              details: metadata,
            },
            { triggerTurn: true, deliverAs: "followUp" },
          );
        };
        child.once("exit", handleCompletion);
        if (child.exitCode !== null || child.signalCode !== null) {
          await handleCompletion(child.exitCode, child.signalCode);
        }
        child.unref();
        await stdoutHandle.close();
        await stderrHandle.close();
        return jsonResult(metadata);
      }

      const metadata = await loadDelegate(repository.commonDir, params.id);
      const paths = delegatePaths(repository.commonDir, params.id);
      const alive = processAlive(metadata.pid);
      if (metadata.status === "running" && !alive) {
        metadata.status = "finished";
        await saveDelegate(paths.metadata, metadata);
      }

      if (params.action === "stop") {
        if (alive) process.kill(metadata.pid, "SIGTERM");
        metadata.status = "stopped";
        await saveDelegate(paths.metadata, metadata);
        return jsonResult(metadata);
      }

      if (params.action === "integrate") {
        if (alive) throw new Error("Delegate is still running; wait or stop it before integration.");
        if (metadata.status !== "finished") {
          throw new Error(`Delegate is ${metadata.status}; only finished delegates can be integrated.`);
        }
        const delegateStatus = await git(metadata.worktree, ["status", "--porcelain"]);
        if (delegateStatus) {
          throw new Error("Delegate worktree has uncommitted changes; commit them before integration.");
        }
        const parentStatus = await git(repository.root, ["status", "--porcelain"]);
        if (parentStatus) {
          throw new Error(
            "Parent worktree must be clean before delegate integration so the squashed change stays isolated.",
          );
        }
        try {
          await git(repository.root, ["merge", "--squash", metadata.branch]);
        } catch (error) {
          await git(repository.root, ["reset", "--hard", "HEAD"]).catch(() => "");
          throw error;
        }
        const staged = await git(repository.root, ["diff", "--cached", "--name-status"]);
        if (!staged) {
          throw new Error("Delegate has no new changes to integrate against the current parent HEAD.");
        }
        return jsonResult({
          integrated: metadata.id,
          branch: metadata.branch,
          staged,
          commitCreated: false,
          next: "Run parent verification, commit the staged squashed change, then cleanup the delegate.",
        });
      }

      if (params.action === "cleanup") {
        if (alive) throw new Error("Delegate is still running; stop it before cleanup.");
        const recoveredStaleWorktree = await removeWorktree(metadata);
        let branchDeleted = false;
        if (params.deleteBranch) {
          const branch = await git(metadata.repoRoot, ["branch", "--list", metadata.branch]);
          if (branch) {
            await git(metadata.repoRoot, ["branch", "-D", metadata.branch]);
            branchDeleted = true;
          }
        }
        await Promise.all([
          rm(paths.metadata, { force: true }),
          rm(metadata.stdoutPath, { force: true }),
          rm(metadata.stderrPath, { force: true }),
        ]);
        await Promise.all([
          removeEmptyParents(metadata.worktree, 2),
          removeEmptyParents(paths.metadata, 2),
        ]);
        return jsonResult({
          cleaned: metadata.id,
          branch: metadata.branch,
          branchDeleted,
          recoveredStaleWorktree,
          artifactsRemoved: true,
        });
      }

      const [stdout, stderr, status, head] = await Promise.all([
        tail(metadata.stdoutPath),
        tail(metadata.stderrPath),
        git(metadata.worktree, ["status", "--short"]).catch((error) => String(error)),
        git(metadata.worktree, ["rev-parse", "HEAD"]).catch(() => "unknown"),
      ]);
      return jsonResult({ ...metadata, alive, head, worktreeStatus: status, stdout, stderr });
    },
  });
}
