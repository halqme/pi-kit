import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HERDR_NAME_MAX = 32;
const NAMESPACE_LENGTH = 6;
const PREFIX_LENGTH = NAMESPACE_LENGTH + 1;
const LOGICAL_NAME_MAX = HERDR_NAME_MAX - PREFIX_LENGTH;

export interface AgentNamespace {
  readonly id: string;
  readonly prefix: string;
  qualify(logicalName: string): string;
  owns(physicalName: string): boolean;
  logicalName(physicalName: string): string | undefined;
}

export async function createAgentNamespace(cwd: string): Promise<AgentNamespace> {
  const root = await namespaceRoot(cwd);
  const id = createHash("sha256").update(root).digest("hex").slice(0, NAMESPACE_LENGTH);
  const prefix = `${id}-`;
  return {
    id,
    prefix,
    qualify(logicalName: string): string {
      const name = logicalName.trim();
      validateLogicalName(name);
      return `${prefix}${name}`;
    },
    owns(physicalName: string): boolean {
      return physicalName.startsWith(prefix);
    },
    logicalName(physicalName: string): string | undefined {
      return physicalName.startsWith(prefix) ? physicalName.slice(prefix.length) : undefined;
    },
  };
}

export function validateLogicalName(name: string): void {
  const pattern = new RegExp(`^[a-z][a-z0-9_-]{0,${LOGICAL_NAME_MAX - 1}}$`);
  if (!pattern.test(name)) {
    throw new Error(
      `agent name must match [a-z][a-z0-9_-]{0,${LOGICAL_NAME_MAX - 1}} before repository namespacing`,
    );
  }
}

async function namespaceRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8" },
    );
    const value = stdout.trim();
    if (value) return await canonicalPath(value);
  } catch {
    // Non-Git directories are namespaced by their canonical working directory.
  }
  return canonicalPath(cwd);
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}
