import { access, readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { MetricsReport } from "./analyze.ts";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function installedPackageSkillRoots(): Promise<string[]> {
  const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
  try {
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as { packages?: string[] };
    const roots: string[] = [];
    for (const source of settings.packages ?? []) {
      const packageRoot = source.startsWith("npm:")
        ? join(homedir(), ".pi", "agent", "npm", "node_modules", source.slice(4))
        : resolve(dirname(settingsPath), source);
      try {
        const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
          pi?: { skills?: string[] };
        };
        for (const skillRoot of manifest.pi?.skills ?? [])
          roots.push(resolve(packageRoot, skillRoot));
      } catch {
        // A package can be unavailable while its source remains in settings.
      }
    }
    return roots;
  } catch {
    return [];
  }
}

async function findSkillRoots(root: string, depth: number): Promise<string[]> {
  if (depth < 0) return [];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const roots: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(root, entry.name);
      if (entry.name === "skills") roots.push(path);
      else roots.push(...(await findSkillRoots(path, depth - 1)));
    }
    return roots;
  } catch {
    return [];
  }
}

export async function addSkillAvailability(report: MetricsReport): Promise<MetricsReport> {
  const globalRoots = [
    join(homedir(), ".pi", "agent", "skills"),
    join(homedir(), ".agents", "skills"),
  ];
  globalRoots.push(...(await findSkillRoots(join(homedir(), ".pi", "agent", "git"), 4)));
  globalRoots.push(...(await installedPackageSkillRoots()));
  const hasSkill = async (roots: string[], name: string): Promise<boolean> => {
    for (const root of roots) if (await exists(join(root, name, "SKILL.md"))) return true;
    return false;
  };
  for (const name of Object.keys(report.skills)) {
    const skill = report.skills[name];
    if (skill) skill.existsGlobally = await hasSkill(globalRoots, name);
  }
  for (const [cwd, project] of Object.entries(report.projects)) {
    if (cwd === "(unknown)") continue;
    const roots = [join(cwd, "skills"), join(cwd, ".pi", "skills"), join(cwd, ".agents", "skills")];
    for (const name of Object.keys(project.skills)) {
      const skill = project.skills[name];
      if (skill) skill.existsInProject = await hasSkill(roots, name);
    }
  }
  return report;
}
