export type ToolKind = "mutation" | "verification" | "other";

export interface TurnObservation {
  mutations: number;
  verifications: number;
  failures: number;
  failedTools: string[];
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
  result: { toolName: string; input: unknown; isError: boolean },
): void {
  const kind = classifyTool(result.toolName, result.input);
  if (kind === "mutation") observation.mutations += 1;
  if (kind === "verification") observation.verifications += 1;
  if (result.isError) {
    observation.failures += 1;
    observation.failedTools.push(result.toolName);
  }
}
