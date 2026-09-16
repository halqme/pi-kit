import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { RuntimeFingerprint } from "./types.ts";

const execFileAsync = promisify(execFile);
const extensionDir = dirname(fileURLToPath(import.meta.url));

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", extensionDir, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.trimEnd();
}

export async function currentRuntimeFingerprint(): Promise<RuntimeFingerprint | undefined> {
  try {
    const revision = (await git(["rev-parse", "HEAD"])).trim();
    if (!revision) return undefined;

    const [diff, status] = await Promise.all([
      git(["diff", "HEAD", "--", "."]),
      git(["status", "--porcelain=v1", "--untracked-files=all"]),
    ]);
    const dirty = status.length > 0;
    const suffix = dirty
      ? `+${createHash("sha256").update(diff).update("\0").update(status).digest("hex").slice(0, 12)}`
      : "";
    return {
      revision,
      dirty,
      fingerprint: `${revision.slice(0, 12)}${suffix}`,
      capturedAt: new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}
