import { execFile } from "node:child_process";
import { readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

function isWithin(root: string, target: string): boolean {
  const relation = relative(root, target);
  return (
    relation === "" ||
    (relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
  );
}

interface ProjectRoot {
  lexical: string;
  real: string;
}

async function projectRoot(cwd: string): Promise<ProjectRoot> {
  const lexicalCwd = resolve(cwd);
  const realCwd = await realpath(lexicalCwd);
  try {
    const { stdout } = await exec("git", ["rev-parse", "--show-toplevel"], {
      cwd: lexicalCwd,
      encoding: "utf8",
      timeout: 10_000,
    });
    const root = stdout.trim();
    if (!root) return { lexical: lexicalCwd, real: realCwd };
    const realRoot = await realpath(root);
    return {
      lexical: resolve(lexicalCwd, relative(realCwd, realRoot)),
      real: realRoot,
    };
  } catch {
    return { lexical: lexicalCwd, real: realCwd };
  }
}

export interface ExistingScope {
  path: string;
  kind: "file" | "directory";
}

export async function resolveExistingScope(
  cwd: string,
  requestedPath: string,
): Promise<ExistingScope> {
  const root = await projectRoot(cwd);
  const candidates = isAbsolute(requestedPath)
    ? [requestedPath]
    : [...new Set([resolve(cwd, requestedPath), resolve(root.lexical, requestedPath)])];
  let outsideProject = false;

  for (const lexicalPath of candidates) {
    let realTarget: string;
    try {
      realTarget = await realpath(lexicalPath);
    } catch {
      continue;
    }
    if (!isWithin(root.real, realTarget)) {
      outsideProject = true;
      continue;
    }
    const targetStat = await stat(realTarget);
    if (targetStat.isFile()) return { path: lexicalPath, kind: "file" };
    if (targetStat.isDirectory()) return { path: lexicalPath, kind: "directory" };
    throw new Error("scope must refer to an existing file or directory");
  }

  if (outsideProject) throw new Error("scope must stay within the current project root");
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
