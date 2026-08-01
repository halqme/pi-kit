import { readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

function isWithin(root: string, target: string): boolean {
  const relation = relative(root, target);
  return (
    relation === "" ||
    (relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
  );
}

export interface ExistingScope {
  path: string;
  kind: "file" | "directory";
}

export async function resolveExistingScope(
  cwd: string,
  requestedPath: string,
): Promise<ExistingScope> {
  const realCwd = await realpath(cwd);
  const lexicalPath = resolve(cwd, requestedPath);
  let realTarget: string;
  try {
    realTarget = await realpath(lexicalPath);
  } catch {
    throw new Error("scope must refer to an existing file or directory");
  }
  if (!isWithin(realCwd, realTarget)) {
    throw new Error("scope must stay within the working directory");
  }
  const targetStat = await stat(realTarget);
  if (targetStat.isFile()) return { path: realTarget, kind: "file" };
  if (targetStat.isDirectory()) return { path: realTarget, kind: "directory" };
  throw new Error("scope must refer to an existing file or directory");
}

export async function resolveExistingPath(cwd: string, requestedPath: string): Promise<string> {
  const scope = await resolveExistingScope(cwd, requestedPath);
  if (scope.kind !== "file") throw new Error("path must refer to an existing file");
  return scope.path;
}

export async function sourceFilesInScope(
  cwd: string,
  requestedPath: string,
  isSupported: (path: string) => boolean,
): Promise<string[]> {
  const scope = await resolveExistingScope(cwd, requestedPath);
  if (scope.kind === "file") return isSupported(scope.path) ? [scope.path] : [];

  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && isSupported(path)) files.push(path);
    }
  };
  await visit(scope.path);
  return files;
}

export function resolveLexicalPath(cwd: string, requestedPath: string): string {
  return resolve(cwd, requestedPath);
}

export function pathIsWithin(root: string, target: string): boolean {
  return isWithin(resolve(root), resolve(target));
}
