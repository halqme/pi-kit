import { basename, dirname } from "node:path";
import { textContent } from "../events.ts";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function explicitSkillNames(content: unknown): string[] {
  const text = textContent(content);
  return [...text.matchAll(/(?:^|\s)\/skill:([a-z0-9-]+)/gi)].map((match) => match[1]!.toLowerCase());
}

export function skillReadPath(toolName: string, input: unknown): string | undefined {
  if (toolName !== "read") return undefined;
  const args = record(input);
  const path = args && (args.path ?? args.file);
  if (typeof path !== "string") return undefined;
  const normalized = path.replaceAll("\\", "/");
  if (/(?:^|\/)SKILL\.md$/i.test(normalized)) return path;
  return /(?:^|\/)skills\/.+\.md$/i.test(normalized) ? path : undefined;
}

function frontmatterName(content: unknown): string | undefined {
  const text = textContent(content);
  const frontmatter = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const match = frontmatter?.match(/^name:\s*["']?([^"'#\r\n]+?)["']?\s*$/im);
  return match?.[1]?.trim().toLowerCase() || undefined;
}

export function skillNameFromRead(path: string, content: unknown): string {
  const declared = frontmatterName(content);
  if (declared) return declared;
  return basename(path).toLowerCase() === "skill.md"
    ? basename(dirname(path)).toLowerCase()
    : basename(path).replace(/\.md$/i, "").toLowerCase();
}
