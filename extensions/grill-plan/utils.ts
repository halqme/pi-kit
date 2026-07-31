export interface PlanStep {
  step: number;
  text: string;
  completed: boolean;
}

export type PlanPhase = "idle" | "planning" | "ready" | "executing";

export interface PlanSidecar {
  version: 1;
  sourceSessionId: string;
  cwd: string;
  updatedAt: string;
  phase: PlanPhase;
  goal?: string;
  planText?: string;
  steps: PlanStep[];
}

const TRANSIENT_CONTEXT_TYPES = new Set([
  "grill-plan-context",
  "grill-plan-execute",
  "grill-plan-execution-context",
]);

/** Remove extension-generated instructions that must be replaced on every turn. */
export function filterTransientContextMessages<T extends object>(messages: T[]): T[] {
  return messages.filter((message) => {
    const customType = (message as { customType?: unknown }).customType;
    return typeof customType !== "string" || !TRANSIENT_CONTEXT_TYPES.has(customType);
  });
}

const PLAN_PHASES = new Set<PlanPhase>(["idle", "planning", "ready", "executing"]);
const PLAN_SECTION_HEADERS = [
  "課題",
  "原因",
  "修正するべき点",
  "対処法",
  "実際に編集するファイル",
  "Plan",
] as const;

const SIMPLE_READ_COMMANDS = new Set([
  "bat",
  "cat",
  "df",
  "diff",
  "du",
  "eza",
  "fd",
  "file",
  "grep",
  "head",
  "jq",
  "ls",
  "pwd",
  "rg",
  "sort",
  "stat",
  "tail",
  "tree",
  "type",
  "uname",
  "uniq",
  "uptime",
  "wc",
  "which",
  "whoami",
]);

const FORBIDDEN_SHELL_SYNTAX = /(?:\n|\r|;|&&|\|\||`|\$\(|<|>|&)/;
const FORBIDDEN_FIND_OPTIONS =
  /(?:^|\s)-(?:delete|exec|execdir|ok|okdir|fls|fprint|fprint0)(?:\s|$)/i;

function firstWord(command: string): string {
  return command.trim().split(/\s+/, 1)[0] ?? "";
}

function isSafeGitCommand(command: string): boolean {
  if (/--(?:output|ext-diff|textconv)(?:[=\s]|$)/i.test(command)) return false;
  if (/^git\s+(?:status|log|diff|show|rev-parse|ls-files)(?:\s|$)/i.test(command)) return true;
  if (/^git\s+remote(?:\s+-v)?\s*$/i.test(command)) return true;
  return /^git\s+branch(?:\s+(?:--list|-a|-r|-v|-vv))*\s*$/i.test(command);
}

function isSafePackageQuery(command: string): boolean {
  if (/(?:^|\s)--fix(?:[=\s]|$)/i.test(command)) return false;
  return (
    /^(?:npm|pnpm)\s+(?:list|ls|view|info|outdated|audit)(?:\s|$)/i.test(command) ||
    /^yarn\s+(?:list|info|why|audit)(?:\s|$)/i.test(command)
  );
}

function isSafePipelineSegment(segment: string): boolean {
  const command = segment.trim();
  if (!command) return false;
  if (isSafeGitCommand(command) || isSafePackageQuery(command)) return true;

  const executable = firstWord(command);
  if (!SIMPLE_READ_COMMANDS.has(executable)) return false;
  if (executable === "find" && FORBIDDEN_FIND_OPTIONS.test(command)) return false;
  if (executable === "fd" && /(?:^|\s)(?:-x|-X|--exec|--exec-batch)(?:[=\s]|$)/i.test(command))
    return false;
  if (executable === "rg" && /(?:^|\s)--pre(?:[=\s]|$)/i.test(command)) return false;
  if (executable === "sort" && /(?:^|\s)(?:-o|--output)(?:[=\s]|$)/i.test(command)) return false;
  if (executable === "diff" && /(?:^|\s)--to-file(?:[=\s]|$)/i.test(command)) return false;
  return true;
}

export function isSafeReadOnlyCommand(command: string): boolean {
  if (!command.trim() || FORBIDDEN_SHELL_SYNTAX.test(command)) return false;
  return command.split("|").every(isSafePipelineSegment);
}

// Accept the markdown heading styles commonly used by agents (for example
// `## Plan:` and `**課題:**`) while keeping the section order unambiguous.
function sectionHeaderPattern(section: string): RegExp {
  return new RegExp(`^\\s*(?:#{1,6}\\s*)?(?:\\*\\*)?${section}(?:\\*\\*)?[：:]\\s*$`, "im");
}

export function extractPlanSteps(message: string): PlanStep[] {
  const header = sectionHeaderPattern("Plan").exec(message);
  if (header?.index === undefined) return [];

  const planSection = message.slice(header.index + header[0].length);
  const steps: PlanStep[] = [];
  for (const match of planSection.matchAll(/^\s*(\d+)[.)]\s+(.+)$/gm)) {
    const text = match[2]?.replace(/\s+/g, " ").trim();
    if (text && text.length > 3) {
      steps.push({ step: steps.length + 1, text, completed: false });
    }
  }
  return steps;
}

export function extractPlanText(message: string): string | undefined {
  const positions: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const section of PLAN_SECTION_HEADERS) {
    const pattern = sectionHeaderPattern(section);
    const match = pattern.exec(message.slice(cursor));
    if (match?.index === undefined) return undefined;
    const absoluteIndex = cursor + match.index;
    const end = absoluteIndex + match[0].length;
    positions.push({ start: absoluteIndex, end });
    cursor = end;
  }
  for (let index = 0; index < positions.length; index += 1) {
    const position = positions[index]!;
    const next = positions[index + 1];
    if (!message.slice(position.end, next?.start ?? message.length).trim()) return undefined;
  }
  return message.slice(positions[0]!.start).trim();
}

export function markCompletedSteps(message: string, steps: PlanStep[]): number {
  const completedSteps = [...message.matchAll(/\[DONE:(\d+)]/gi)].map((match) => Number(match[1]));
  return markCompletedStepNumbers(completedSteps, steps);
}

export function markCompletedStepNumbers(completedSteps: number[], steps: PlanStep[]): number {
  let changed = 0;
  for (const step of completedSteps) {
    const item = steps.find((candidate) => candidate.step === step);
    if (item && !item.completed) {
      item.completed = true;
      changed += 1;
    }
  }
  return changed;
}

export function planSidecarFilename(sessionId: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) throw new Error("Invalid session ID");
  return `${sessionId}.grill-plan.json`;
}

export function planMarkdownFilename(sessionId: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) throw new Error("Invalid session ID");
  return `${sessionId}.grill-plan.md`;
}

export function planSidecarMarkdown(snapshot: PlanSidecar): string {
  const lines = [
    "# Grill Plan",
    "",
    `- Phase: \`${snapshot.phase}\``,
    `- Session: \`${snapshot.sourceSessionId}\``,
    `- Working directory: \`${snapshot.cwd}\``,
    `- Updated: ${snapshot.updatedAt}`,
  ];
  if (snapshot.goal) lines.push(`- Goal: ${snapshot.goal}`);
  lines.push(
    "",
    "## Plan",
    "",
    snapshot.planText ?? "_(No completed plan text.)_",
    "",
    "## Steps",
    "",
  );
  for (const step of snapshot.steps) {
    lines.push(`${step.completed ? "- [x]" : "- [ ]"} ${step.text}`);
  }
  return `${lines.join("\n")}\n`;
}

export function parsePlanSidecar(value: unknown): PlanSidecar {
  if (!value || typeof value !== "object") throw new Error("Plan sidecar must be an object");
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) throw new Error("Unsupported plan sidecar version");
  if (typeof candidate.sourceSessionId !== "string" || !candidate.sourceSessionId) {
    throw new Error("Plan sidecar is missing sourceSessionId");
  }
  if (typeof candidate.cwd !== "string" || !candidate.cwd) {
    throw new Error("Plan sidecar is missing cwd");
  }
  if (typeof candidate.updatedAt !== "string" || Number.isNaN(Date.parse(candidate.updatedAt))) {
    throw new Error("Plan sidecar has an invalid updatedAt");
  }
  if (typeof candidate.phase !== "string" || !PLAN_PHASES.has(candidate.phase as PlanPhase)) {
    throw new Error("Plan sidecar has an invalid phase");
  }
  if (candidate.goal !== undefined && typeof candidate.goal !== "string") {
    throw new Error("Plan sidecar has an invalid goal");
  }
  if (candidate.planText !== undefined && typeof candidate.planText !== "string") {
    throw new Error("Plan sidecar has an invalid planText");
  }
  if (!Array.isArray(candidate.steps)) throw new Error("Plan sidecar is missing steps");
  const steps = candidate.steps.map((step, index): PlanStep => {
    if (!step || typeof step !== "object") throw new Error("Plan sidecar has an invalid step");
    const item = step as Record<string, unknown>;
    if (
      typeof item.step !== "number" ||
      item.step !== index + 1 ||
      typeof item.text !== "string" ||
      !item.text.trim() ||
      typeof item.completed !== "boolean"
    ) {
      throw new Error("Plan sidecar has an invalid step");
    }
    return { step: item.step, text: item.text, completed: item.completed };
  });

  return {
    version: 1,
    sourceSessionId: candidate.sourceSessionId,
    cwd: candidate.cwd,
    updatedAt: candidate.updatedAt,
    phase: candidate.phase as PlanPhase,
    ...(candidate.goal === undefined ? {} : { goal: candidate.goal as string }),
    ...(candidate.planText === undefined ? {} : { planText: candidate.planText as string }),
    steps,
  };
}
