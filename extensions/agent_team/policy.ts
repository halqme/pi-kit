export const AGENT_TEAM_TOOL_NAMES = ["read", "grep", "find", "ls"] as const;
export type AgentTeamToolName = (typeof AGENT_TEAM_TOOL_NAMES)[number];

export const AGENT_TEAM_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type AgentTeamThinkingLevel = (typeof AGENT_TEAM_THINKING_LEVELS)[number];

export const DEFAULT_AGENT_TEAM_THINKING: AgentTeamThinkingLevel = "low";

const AGENT_TEAM_TOOL_SET = new Set<string>(AGENT_TEAM_TOOL_NAMES);
const AGENT_TEAM_THINKING_SET = new Set<string>(AGENT_TEAM_THINKING_LEVELS);

export function validateAgentTeamTools(requested?: readonly string[]): AgentTeamToolName[] {
  const selected = requested === undefined ? [...AGENT_TEAM_TOOL_NAMES] : [...requested];
  const unique = [...new Set(selected)];
  const unsupported = unique.filter((tool) => !AGENT_TEAM_TOOL_SET.has(tool));
  if (unsupported.length > 0) {
    throw new Error(
      `agent-team only accepts child-safe read-only tools (${AGENT_TEAM_TOOL_NAMES.join(", ")}); unsupported: ${unsupported.join(", ")}`,
    );
  }
  return unique as AgentTeamToolName[];
}

export function isAgentTeamThinkingLevel(value: unknown): value is AgentTeamThinkingLevel {
  return typeof value === "string" && AGENT_TEAM_THINKING_SET.has(value);
}

export function validateAgentTeamThinking(value: unknown): AgentTeamThinkingLevel {
  if (value === undefined) return DEFAULT_AGENT_TEAM_THINKING;
  if (isAgentTeamThinkingLevel(value)) return value;
  throw new Error(
    `agent-team supports thinking levels: ${AGENT_TEAM_THINKING_LEVELS.join(", ")}; received: ${String(value)}`,
  );
}
