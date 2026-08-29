import { lstat, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

/** Finds Pi session JSONL files without following directory symlinks or maintaining an index. */
export async function sessionFiles(target: string): Promise<string[]> {
  const paths = new Set<string>();

  async function visit(path: string): Promise<void> {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return;
    if (info.isFile()) {
      if (path.endsWith(".jsonl")) paths.add(await realpath(path));
      return;
    }
    if (!info.isDirectory()) return;
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) continue;
      await visit(join(path, entry.name));
    }
  }

  await visit(target);
  return [...paths].sort();
}
