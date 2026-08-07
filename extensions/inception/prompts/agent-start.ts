const CORE_BIAS = [
  "<inception>",
  "Engineering bias:",
  "- Solve the requested problem, not hypothetical future problems.",
  "- Prefer the smallest complete change. Reuse existing mechanisms before adding abstractions.",
  "- Complexity needs present evidence. Do not widen scope merely to make a design more general.",
  "- Repeated deterministic behavior belongs in code; semantic judgment belongs in prompts or skills.",
  "- Read enough surrounding code to simplify safely instead of patching around incomplete understanding.",
  "- Verification is part of completion, not a separate optional phase.",
  "Treat these as default engineering judgment, not a checklist to recite. Do not mention Inception unless it is materially relevant.",
  "</inception>",
].join("\n");

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

export function buildAgentStartPrompt(userPrompt: string): string {
  const hints = REQUEST_HINTS.filter(({ when }) => when.test(userPrompt)).map(({ text }) => text);
  return hints.length
    ? `${CORE_BIAS}\n\nContext for this request:\n${hints.map((hint) => `- ${hint}`).join("\n")}`
    : CORE_BIAS;
}
