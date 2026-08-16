import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WorktreeManager } from "./core.ts";

export class GitWorktreeManager implements WorktreeManager {
  constructor(private readonly pi: Pick<ExtensionAPI, "exec">) {}

  private async git(cwd: string, args: string[]): Promise<string> {
    const result = await this.pi.exec("git", args, { cwd });
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).trim();
      throw new Error(`git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
    }
    return result.stdout.trim();
  }

  async repoRoot(cwd: string): Promise<string> {
    return resolve(await this.git(cwd, ["rev-parse", "--show-toplevel"]));
  }

  async head(repoRoot: string): Promise<string> {
    return this.git(repoRoot, ["rev-parse", "HEAD"]);
  }

  async status(worktreePath: string): Promise<string> {
    return this.git(worktreePath, ["status", "--porcelain"]);
  }

  async create(
    repoRoot: string,
    worktreePath: string,
    branch: string,
    baseSha: string,
  ): Promise<void> {
    await mkdir(dirname(worktreePath), { recursive: true });
    await this.git(repoRoot, ["worktree", "add", "-b", branch, worktreePath, baseSha]);
  }

  async exists(worktreePath: string): Promise<boolean> {
    try {
      return (await this.repoRoot(worktreePath)) === resolve(worktreePath);
    } catch {
      return false;
    }
  }

  async remove(repoRoot: string, worktreePath: string): Promise<void> {
    await this.git(repoRoot, ["worktree", "remove", worktreePath]);
  }
}
