export type PlanStage = "grill" | "planner" | "runner";
export type PlanStatus =
  | "idle"
  | "grilling"
  | "resolved"
  | "planned"
  | "approved"
  | "running"
  | "completed"
  | "stopped";

export interface PlanStep {
  step: number;
  text: string;
  completed: boolean;
}
export interface PlanState {
  version: 1;
  goal?: string;
  architecture?: string;
  todo?: string;
  steps: PlanStep[];
  status: PlanStatus;
  stage: PlanStage;
  stopReason?: string;
}

export const PLAN_STATE_ENTRY = "plan-state";

export function emptyPlan(stage: PlanStage = "grill", goal?: string): PlanState {
  return {
    version: 1,
    ...(goal?.trim() ? { goal: goal.trim() } : {}),
    steps: [],
    status: "idle",
    stage,
  };
}

export function validatePlanState(value: unknown): PlanState {
  if (!value || typeof value !== "object") throw new Error("Plan state must be an object");
  const item = value as Record<string, unknown>;
  if (item.version !== 1 || !Array.isArray(item.steps))
    throw new Error("Invalid plan state version or steps");
  if (!["grill", "planner", "runner"].includes(String(item.stage)))
    throw new Error("Invalid plan stage");
  const statuses = [
    "idle",
    "grilling",
    "resolved",
    "planned",
    "approved",
    "running",
    "completed",
    "stopped",
  ];
  if (!statuses.includes(String(item.status))) throw new Error("Invalid plan status");
  const steps = item.steps.map((raw, index): PlanStep => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid plan step");
    const step = raw as Record<string, unknown>;
    if (
      step.step !== index + 1 ||
      typeof step.text !== "string" ||
      !step.text.trim() ||
      typeof step.completed !== "boolean"
    )
      throw new Error("Invalid plan step");
    return { step: step.step, text: step.text, completed: step.completed };
  });
  return {
    version: 1,
    ...(typeof item.goal === "string" ? { goal: item.goal } : {}),
    ...(typeof item.architecture === "string" ? { architecture: item.architecture } : {}),
    ...(typeof item.todo === "string" ? { todo: item.todo } : {}),
    steps,
    status: item.status as PlanStatus,
    stage: item.stage as PlanStage,
    ...(typeof item.stopReason === "string" ? { stopReason: item.stopReason } : {}),
  };
}

export function completedSteps(state: PlanState): number {
  return state.steps.filter((step) => step.completed).length;
}
export function remainingSteps(state: PlanState): PlanStep[] {
  return state.steps.filter((step) => !step.completed);
}
export function recordProgress(state: PlanState, numbers: number[]): number {
  const requested = new Set(numbers);
  if ([...requested].some((number) => !state.steps.some((step) => step.step === number)))
    throw new Error("Unknown plan step");
  let changed = 0;
  for (const step of state.steps)
    if (requested.has(step.step) && !step.completed) {
      step.completed = true;
      changed += 1;
    }
  if (state.steps.length > 0 && state.steps.every((step) => step.completed))
    state.status = "completed";
  return changed;
}

export function savePlanState(
  pi: { appendEntry(type: string, data: unknown): void },
  state: PlanState,
): void {
  pi.appendEntry(PLAN_STATE_ENTRY, validatePlanState(state));
}

export function restorePlanState(
  entries: Array<{ type?: string; customType?: string; data?: unknown }>,
): PlanState | undefined {
  const entry = [...entries]
    .reverse()
    .find((candidate) => candidate.type === "custom" && candidate.customType === PLAN_STATE_ENTRY);
  return entry?.data === undefined ? undefined : validatePlanState(entry.data);
}
