export type ToolKind = "mutation" | "verification" | "other";

export interface ToolResultObservation {
  toolName: string;
  input: unknown;
  isError: boolean;
}

export interface TurnObservation {
  mutations: number;
  verifications: number;
  failures: number;
  failedTools: string[];
}

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

function field(input: unknown, name: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

function looksLikeVerification(command: string): boolean {
  return /\b(?:bun|npm|pnpm|yarn)\b[^\n]*\b(?:test|check|lint|typecheck)\b|\b(?:pytest|cargo\s+test|go\s+test|tsc\s+--noEmit|oxlint|git\s+diff\s+--check)\b/i.test(
    command,
  );
}

function looksLikeMutation(command: string): boolean {
  return /\bgit\s+(?:add|commit|checkout|switch|reset|restore|merge|rebase)\b|\b(?:rm|mv|cp|mkdir|touch)\b|\b(?:sed\s+-i|perl\s+-pi)\b|(?:^|\s)(?:>>|>)(?:\s|$)/i.test(
    command,
  );
}

export function classifyTool(toolName: string, input: unknown): ToolKind {
  const name = toolName.toLowerCase();
  if (["edit", "write", "apply_patch", "patch"].includes(name)) return "mutation";

  if (name === "astrolabe") {
    const action = field(input, "action")?.toLowerCase();
    return action === "replace" || action === "replace_many" ? "mutation" : "other";
  }

  // These return launch/acceptance, not command completion. Do not turn that into evidence.
  if (name === "background_process" || name === "terminal") return "other";

  if (name === "bash") {
    const command = field(input, "command");
    if (!command) return "other";
    if (looksLikeVerification(command)) return "verification";
    if (looksLikeMutation(command)) return "mutation";
  }

  return "other";
}

export function createTurnObservation(): TurnObservation {
  return { mutations: 0, verifications: 0, failures: 0, failedTools: [] };
}

export function observeToolResult(
  observation: TurnObservation,
  result: ToolResultObservation,
): void {
  const kind = classifyTool(result.toolName, result.input);
  if (kind === "mutation") observation.mutations += 1;
  if (kind === "verification") observation.verifications += 1;
  if (result.isError) {
    observation.failures += 1;
    observation.failedTools.push(result.toolName);
  }
}

export function buildTurnBoundaryPrompt(observation: TurnObservation): string | undefined {
  if (observation.failures === 0 && observation.mutations === 0) return undefined;

  const reminders: string[] = [];
  if (observation.failures > 0) {
    const failed = [...new Set(observation.failedTools)].join(", ");
    reminders.push(
      `A tool or check failed${failed ? ` (${failed})` : ""}. Treat the failure as evidence: identify the causal mechanism before compensating with more code or abstraction, and distinguish environment/tool failure from product failure.`,
    );
  }

  if (observation.mutations > 0)
    reminders.push(
      "Project state changed. Re-read the affected behavior and resulting diff before continuing; remove incidental complexity, reuse existing mechanisms, and do not broaden scope beyond the requested outcome.",
    );

  if (observation.mutations >= 3)
    reminders.push(
      "Several mutation operations accumulated in one turn. Reassess whether every changed surface is necessary before adding another one.",
    );

  if (observation.mutations > 0 && observation.verifications > 0 && observation.failures === 0)
    reminders.push(
      "Checks passed, but passing checks are evidence rather than semantic completion. Compare the actual outcome with the request and account for any unverified acceptance criteria before declaring done.",
    );

  return [
    "<inception-reminder>",
    ...reminders.map((reminder) => `- ${reminder}`),
    "Use this as internal judgment; do not recite it to the user.",
    "</inception-reminder>",
  ].join("\n");
}
