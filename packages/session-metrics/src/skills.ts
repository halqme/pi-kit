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

async function installedPackageRoots(): Promise<string[]> {
  const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
  try {
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as { packages?: string[] };
    const roots: string[] = [];
    for (const source of settings.packages ?? []) {
      const packageRoot = source.startsWith("npm:")
        ? join(homedir(), ".pi", "agent", "npm", "node_modules", source.slice(4))
        : resolve(dirname(settingsPath), source);
      try {
        await readFile(join(packageRoot, "package.json"), "utf8");
        roots.push(packageRoot);
      } catch {
        // A package can be unavailable while its source remains in settings.
      }
    }
    return roots;
  } catch {
    return [];
  }
}

const builtInTools = new Set([
  "bash", "edit", "find", "grep", "ls", "read", "write", "background_process",
]);

async function extensionTools(root: string): Promise<Set<string>> {
  const tools = new Set<string>();
  try {
    const source = /\.(?:ts|js)$/.test(root) ? await readFile(root, "utf8") : undefined;
    if (source !== undefined) {
      for (const match of source.matchAll(/registerTool\(\s*\{\s*name:\s*["']([^"']+)["']/g))
        tools.add(match[1]!);
      return tools;
    }
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) {
        for (const tool of await extensionTools(path)) tools.add(tool);
      } else if (/\.(?:ts|js)$/.test(entry.name)) {
        const source = await readFile(path, "utf8");
        for (const match of source.matchAll(/registerTool\(\s*\{\s*name:\s*["']([^"']+)["']/g))
          tools.add(match[1]!);
      }
    }
  } catch {
    // An unavailable package is not an active tool source.
  }
  return tools;
}

export async function addSkillAvailability(report: MetricsReport): Promise<MetricsReport> {
  const globalRoots = [
    join(homedir(), ".pi", "agent", "skills"),
    join(homedir(), ".agents", "skills"),
  ];
  const packageRoots = await installedPackageRoots();
  for (const packageRoot of packageRoots) {
    try {
      const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
        pi?: { skills?: string[] };
      };
      globalRoots.push(...(manifest.pi?.skills ?? []).map((root) => resolve(packageRoot, root)));
    } catch {
      // An unavailable package has no active skills.
    }
  }
  const hasSkill = async (roots: string[], name: string): Promise<boolean> => {
    for (const root of roots) if (await exists(join(root, name, "SKILL.md"))) return true;
    return false;
  };
  const activeTools = new Set(builtInTools);
  for (const packageRoot of packageRoots) {
    try {
      const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
        pi?: { extensions?: string[] };
      };
      for (const extensionRoot of manifest.pi?.extensions ?? [])
        for (const tool of await extensionTools(resolve(packageRoot, extensionRoot))) activeTools.add(tool);
    } catch {
      // An unavailable package has no active tools.
    }
  }
  for (const [name, usage] of Object.entries(report.toolUsage)) usage.available = activeTools.has(name);

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
