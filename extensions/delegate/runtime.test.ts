import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import test from "node:test";

import extension from "./index.ts";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function registeredDelegate(): any {
  const tools: any[] = [];
  extension({
    registerTool(tool: unknown) {
      tools.push(tool);
    },
  } as any);
  return tools[0];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test("squash integration stages one candidate and cleanup removes delegate artifacts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-kit-delegate-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const repo = join(root, "repo");
  const worktree = join(root, ".pi-worktrees", "repo", "test");
  const branch = "pi/delegate/test";
  const id = "test";
  await mkdir(repo, { recursive: true });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.name", "Pi Kit Test"]);
  git(repo, ["config", "user.email", "pi-kit@example.invalid"]);
  await writeFile(join(repo, "value.txt"), "base\n", "utf8");
  git(repo, ["add", "value.txt"]);
  git(repo, ["commit", "-m", "base"]);
  await mkdir(join(root, ".pi-worktrees", "repo"), { recursive: true });
  git(repo, ["worktree", "add", "-b", branch, worktree, "HEAD"]);

  await writeFile(join(worktree, "value.txt"), "one\n", "utf8");
  git(worktree, ["commit", "-am", "one"]);
  await writeFile(join(worktree, "value.txt"), "two\n", "utf8");
  git(worktree, ["commit", "-am", "two"]);

  const common = git(repo, ["rev-parse", "--git-common-dir"]);
  const commonDir = isAbsolute(common) ? common : resolve(repo, common);
  const delegateDir = join(commonDir, "pi-kit", "delegates");
  const metadataPath = join(delegateDir, `${id}.json`);
  const stdoutPath = join(delegateDir, `${id}.stdout.log`);
  const stderrPath = join(delegateDir, `${id}.stderr.log`);
  await mkdir(delegateDir, { recursive: true });
  await writeFile(stdoutPath, "done\n", "utf8");
  await writeFile(stderrPath, "", "utf8");
  await writeFile(
    metadataPath,
    `${JSON.stringify(
      {
        version: 1,
        id,
        task: "change value",
        acceptance: [],
        repoRoot: repo,
        worktree,
        branch,
        baseRef: "HEAD",
        pid: 2_147_483_647,
        stdoutPath,
        stderrPath,
        status: "finished",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const delegate = registeredDelegate();
  await delegate.execute("integrate", { action: "integrate", id }, undefined, undefined, {
    cwd: repo,
  });

  assert.equal(git(repo, ["rev-list", "--count", "HEAD"]), "1");
  assert.equal(git(repo, ["status", "--short"]), "M  value.txt");
  assert.equal(await readFile(join(repo, "value.txt"), "utf8"), "two\n");

  git(repo, ["commit", "-m", "integrate delegate"]);
  await delegate.execute(
    "cleanup",
    { action: "cleanup", id, deleteBranch: true },
    undefined,
    undefined,
    { cwd: repo },
  );

  assert.equal(await exists(worktree), false);
  assert.equal(await exists(metadataPath), false);
  assert.equal(await exists(stdoutPath), false);
  assert.equal(await exists(stderrPath), false);
  assert.equal(git(repo, ["branch", "--list", branch]), "");
  assert.equal(git(repo, ["worktree", "list", "--porcelain"]).includes(worktree), false);
});
