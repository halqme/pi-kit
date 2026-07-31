import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

function isWithin(root: string, target: string): boolean {
  const relation = relative(root, target);
  return (
    relation === "" ||
    (relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
  );
}

export async function resolveExistingPath(cwd: string, requestedPath: string): Promise<string> {
  const realCwd = await realpath(cwd);
  const lexicalPath = resolve(cwd, requestedPath);
  let realTarget: string;
  try {
    realTarget = await realpath(lexicalPath);
  } catch {
    throw new Error("path must refer to an existing file");
  }
  if (!isWithin(realCwd, realTarget)) {
    throw new Error("path must stay within the working directory");
  }
  const targetStat = await stat(realTarget);
  if (!targetStat.isFile()) throw new Error("path must refer to an existing file");
  return realTarget;
}

export function resolveLexicalPath(cwd: string, requestedPath: string): string {
  return resolve(cwd, requestedPath);
}

export function pathIsWithin(root: string, target: string): boolean {
  return isWithin(resolve(root), resolve(target));
}
