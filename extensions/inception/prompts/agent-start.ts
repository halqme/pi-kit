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

const REQUEST_HINTS: Array<{ when: RegExp; text: string }> = [
  {
    when: /\b(?:refactor|rewrite|cleanup|restructure)\b|リファクタ|整理|書き直|作り直/i,
    text: "For refactoring work, preserve observable behavior unless the request explicitly changes it; prefer deleting accidental structure over replacing it with a new framework.",
  },
  {
    when: /\b(?:design|architecture|architect|abstraction|framework)\b|設計|アーキテクチャ|抽象化|構成/i,
    text: "For design work, separate stable mechanism from policy: mechanize deterministic behavior, but do not create infrastructure for requirements that are only imagined.",
  },
  {
    when: /\b(?:fix|bug|error|failure|debug|diagnos(?:e|is))\b|修正|バグ|エラー|失敗|原因|診断/i,
    text: "For debugging work, establish the causal mechanism before changing code; distinguish product defects from environment, tool, and test failures.",
  },
  {
    when: /\b(?:review|audit|critique)\b|レビュー|監査|評価/i,
    text: "For review work, search for concrete failure modes and unnecessary complexity rather than rewarding abstraction by default.",
  },
];

export function buildAgentStartPrompt(
  userPrompt: string,
  contextFiles: readonly ContextFile[] = [],
): string {
  const hints = REQUEST_HINTS.filter(({ when }) => when.test(userPrompt)).map(({ text }) => text);
  const sections: string[] = [];

  if (!isGlobalPolicyLoaded(contextFiles)) sections.push(GLOBAL_POLICY);
  if (hints.length) {
    sections.push(`Context for this request:\n${hints.map((hint) => `- ${hint}`).join("\n")}`);
  }
  if (sections.length === 0) return "";

  return ["<inception>", ...sections, "</inception>"].join("\n\n");
}
