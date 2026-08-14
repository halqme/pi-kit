import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const GLOBAL_POLICY = readFileSync(new URL("./agents.md", import.meta.url), "utf8").trim();

function normalizePolicy(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}

const NORMALIZED_GLOBAL_POLICY = normalizePolicy(GLOBAL_POLICY);

type ContextFile = { content: string };
type ProjectContext = {
  languages: string[];
  frameworks: string[];
  packageManager?: string;
};

const PROJECT_MARKER_FILES = [
  "package.json",
  "tsconfig.json",
  "deno.json",
  "deno.jsonc",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "Pipfile",
];

const FRAMEWORK_PACKAGES: Array<[string, string]> = [
  ["next", "Next.js"],
  ["react", "React"],
  ["vue", "Vue"],
  ["svelte", "Svelte"],
  ["astro", "Astro"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["@angular/core", "Angular"],
];

const PACKAGE_MANAGER_MARKERS: Array<[string, string]> = [
  ["bun.lock", "Bun"],
  ["bun.lockb", "Bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "Yarn"],
  ["package-lock.json", "npm"],
];

const TARGET_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
};

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function packageNames(manifest: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const sectionName of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
    "catalog",
  ]) {
    const section = manifest[sectionName];
    if (!section || typeof section !== "object" || Array.isArray(section)) continue;
    for (const name of Object.keys(section)) names.add(name);
  }
  return names;
}

function projectDirectories(cwd: string): string[] {
  const directories: string[] = [];
  let current = resolve(cwd);
  while (true) {
    directories.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const gitIndex = directories.findIndex((directory) => existsSync(join(directory, ".git")));
  if (gitIndex >= 0) return directories.slice(0, gitIndex + 1);

  const markerIndex = directories.findIndex((directory) =>
    PROJECT_MARKER_FILES.some((file) => existsSync(join(directory, file))),
  );
  return markerIndex >= 0
    ? directories.slice(0, markerIndex + 1)
    : [directories[0] ?? resolve(cwd)];
}

function detectProjectContext(cwd: string): ProjectContext | undefined {
  const directories = projectDirectories(cwd);
  const languages = new Set<string>();
  const frameworks = new Set<string>();
  let hasPackageManifest = false;
  let hasTypeScript = false;
  let packageManager: string | undefined;

  for (const directory of directories) {
    if (existsSync(join(directory, "deno.json")) || existsSync(join(directory, "deno.jsonc")))
      languages.add("deno");
    if (existsSync(join(directory, "go.mod"))) languages.add("go");
    if (
      ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"].some((file) =>
        existsSync(join(directory, file)),
      )
    )
      languages.add("python");
    if (existsSync(join(directory, "tsconfig.json"))) hasTypeScript = true;

    const manifestPath = join(directory, "package.json");
    const manifest = readJson(manifestPath);
    if (existsSync(manifestPath)) hasPackageManifest = true;
    if (manifest) {
      const names = packageNames(manifest);
      if (names.has("typescript")) hasTypeScript = true;
      for (const [packageName, framework] of FRAMEWORK_PACKAGES) {
        if (names.has(packageName)) frameworks.add(framework);
      }
    }

    if (!packageManager) {
      for (const [marker, manager] of PACKAGE_MANAGER_MARKERS) {
        if (existsSync(join(directory, marker))) {
          packageManager = manager;
          break;
        }
      }
    }
  }

  if (hasTypeScript) languages.add("typescript");
  else if (hasPackageManifest) languages.add("javascript");
  if (languages.size === 0 && frameworks.size === 0 && !packageManager) return undefined;

  return {
    languages: [...languages],
    frameworks: [...frameworks],
    ...(packageManager ? { packageManager } : {}),
  };
}

function targetLanguage(userPrompt: string): string | undefined {
  for (const match of userPrompt.matchAll(/\.(tsx?|jsx?|py|go)\b/gi)) {
    const extension = match[1];
    if (!extension) continue;
    const language = TARGET_LANGUAGE_BY_EXTENSION[`.${extension.toLowerCase()}`];
    if (language) return language;
  }
  return undefined;
}

function buildProjectGuidance(cwd: string, userPrompt: string): string | undefined {
  const context = detectProjectContext(cwd);
  if (!context) return undefined;

  const requestedLanguageFromPath = targetLanguage(userPrompt);
  const requestedLanguage =
    requestedLanguageFromPath === "typescript" && context.languages.includes("deno")
      ? "deno"
      : requestedLanguageFromPath;
  const defaultLanguage =
    requestedLanguage ?? (context.languages.length === 1 ? context.languages[0] : undefined);
  const guidance = ["Project context detected from repository markers:"];
  if (context.languages.length) guidance.push(`- Languages: ${context.languages.join(", ")}.`);
  if (context.frameworks.length) guidance.push(`- Frameworks: ${context.frameworks.join(", ")}.`);
  if (context.packageManager) guidance.push(`- Package manager: ${context.packageManager}.`);
  if (requestedLanguage) guidance.push(`- Target language from the request: ${requestedLanguage}.`);
  if (defaultLanguage) {
    guidance.push(
      `- When calling Astrolabe, set \`language: "${defaultLanguage}"\` for the target. In a mixed repository, prefer the target file's language.`,
    );
  } else {
    guidance.push(
      "- When calling Astrolabe, identify the target file's language and set the `language` parameter explicitly; do not guess from a mixed repository.",
    );
  }
  return guidance.join("\n");
}

function isGlobalPolicyLoaded(contextFiles: readonly ContextFile[]): boolean {
  return contextFiles.some(({ content }) =>
    normalizePolicy(content).includes(NORMALIZED_GLOBAL_POLICY),
  );
}

export function buildAgentStartPrompt(
  cwd: string = process.cwd(),
  userPrompt = "",
  contextFiles: readonly ContextFile[] = [],
): string {
  const sections: string[] = [];
  if (!isGlobalPolicyLoaded(contextFiles)) sections.push(GLOBAL_POLICY);

  const projectGuidance = buildProjectGuidance(cwd, userPrompt);
  if (projectGuidance) sections.push(projectGuidance);

  return sections.join("\n\n");
}
