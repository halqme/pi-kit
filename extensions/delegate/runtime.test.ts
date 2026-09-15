import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";
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
    sendMessage() {},
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

function parsed(result: any): any {
  return JSON.parse(result.content[0]?.text ?? "{}");
}

async function waitForFinished(delegate: any, id: string, ctx: any): Promise<any> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const status = parsed(
      await delegate.execute("status", { action: "status", id }, undefined, undefined, ctx),
    );
    if (status.status === "finished") return status;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  throw new Error(`Delegate ${id} did not finish in time.`);
}

test("worker commits ignore the repository's signing configuration", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-kit-delegate-signing-"));
  const originalPath = process.env.PATH;
  t.after(async () => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await rm(root, { recursive: true, force: true });
  });

  const repo = join(root, "repo");
  const bin = join(root, "bin");
  const fakePi = join(bin, "pi");
  const failingGpg = join(bin, "gpg-fails");
  await mkdir(repo, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(
    fakePi,
    `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
writeFileSync("worker.txt", "worker\\n");
execFileSync("git", ["add", "worker.txt"]);
execFileSync("git", ["commit", "-m", "worker"]);
`,
    "utf8",
  );
  await chmod(fakePi, 0o755);
  await writeFile(failingGpg, "#!/bin/sh\nexit 1\n", "utf8");
  await chmod(failingGpg, 0o755);

  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.name", "Pi Kit Test"]);
  git(repo, ["config", "user.email", "pi-kit@example.invalid"]);
  git(repo, ["config", "commit.gpgSign", "false"]);
  await writeFile(join(repo, "value.txt"), "base\n", "utf8");
  git(repo, ["add", "value.txt"]);
  git(repo, ["commit", "-m", "base"]);
  git(repo, ["config", "commit.gpgSign", "true"]);
  git(repo, ["config", "gpg.program", failingGpg]);

  process.env.PATH = [bin, originalPath].filter(Boolean).join(delimiter);
  const delegate = registeredDelegate();
  const ctx = { cwd: repo };
  const started = parsed(
    await delegate.execute(
      "start",
      { action: "start", task: "make a worker commit" },
      undefined,
      undefined,
      ctx,
    ),
  );
  const status = await waitForFinished(delegate, started.id, ctx);

  assert.equal(status.status, "finished");
  assert.equal(git(status.worktree, ["log", "-1", "--format=%G?"]), "N");

  await delegate.execute(
    "cleanup",
    { action: "cleanup", id: started.id, deleteBranch: true },
    undefined,
    undefined,
    ctx,
  );
});

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
