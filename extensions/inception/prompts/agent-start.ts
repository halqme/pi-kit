import { readFileSync } from "node:fs";

const GLOBAL_POLICY = readFileSync(new URL("./agents.md", import.meta.url), "utf8").trim();

function normalizePolicy(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}

const NORMALIZED_GLOBAL_POLICY = normalizePolicy(GLOBAL_POLICY);

type ContextFile = { content: string };

function isGlobalPolicyLoaded(contextFiles: readonly ContextFile[]): boolean {
  return contextFiles.some(({ content }) =>
    normalizePolicy(content).includes(NORMALIZED_GLOBAL_POLICY),
  );
}

export function buildAgentStartPrompt(contextFiles: readonly ContextFile[] = []): string {
  if (isGlobalPolicyLoaded(contextFiles)) return "";
  return GLOBAL_POLICY;
}
