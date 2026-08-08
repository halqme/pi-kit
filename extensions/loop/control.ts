export type LoopOwner = "loop" | "runner";
export type LoopStatus = "active" | "done" | "blocked" | "exhausted" | "stopped";

export interface LoopReport {
  status: "continue";
  summary?: string;
}

export interface LoopState {
  version: 1;
  owner: LoopOwner;
  task: string;
  maxTurns: number;
  turns: number;
  status: LoopStatus;
  pendingReport?: LoopReport;
  lastSummary?: string;
  stopReason?: string;
}

export interface AgentEndResult {
  followUp?: string;
  exhausted?: boolean;
}

type Persist = (state: LoopState | undefined) => void;
type ExhaustedHandler = (state: LoopState) => void;

function copyState(state: LoopState | undefined): LoopState | undefined {
  return state ? structuredClone(state) : undefined;
}

export function validateLoopState(value: unknown): LoopState {
  if (!value || typeof value !== "object") throw new Error("Loop state must be an object");
  const item = value as Record<string, unknown>;
  if (item.version !== 1) throw new Error("Invalid loop state version");
  if (item.owner !== "loop" && item.owner !== "runner") throw new Error("Invalid loop owner");
  if (typeof item.task !== "string" || !item.task.trim()) throw new Error("Invalid loop task");
  if (!Number.isInteger(item.maxTurns) || Number(item.maxTurns) < 1)
    throw new Error("Invalid loop maxTurns");
  if (!Number.isInteger(item.turns) || Number(item.turns) < 0)
    throw new Error("Invalid loop turns");
  if (!["active", "done", "blocked", "exhausted", "stopped"].includes(String(item.status)))
    throw new Error("Invalid loop status");

  let pendingReport: LoopReport | undefined;
  if (item.pendingReport !== undefined) {
    if (!item.pendingReport || typeof item.pendingReport !== "object")
      throw new Error("Invalid loop report");
    const report = item.pendingReport as Record<string, unknown>;
    if (report.status !== "continue") throw new Error("Invalid loop report status");
    pendingReport = {
      status: "continue",
      ...(typeof report.summary === "string" && report.summary.trim()
        ? { summary: report.summary.trim() }
        : {}),
    };
  }

  return {
    version: 1,
    owner: item.owner,
    task: item.task.trim(),
    maxTurns: Number(item.maxTurns),
    turns: Number(item.turns),
    status: item.status as LoopStatus,
    ...(pendingReport ? { pendingReport } : {}),
    ...(typeof item.lastSummary === "string" && item.lastSummary.trim()
      ? { lastSummary: item.lastSummary.trim() }
      : {}),
    ...(typeof item.stopReason === "string" && item.stopReason.trim()
      ? { stopReason: item.stopReason.trim() }
      : {}),
  };
}

class LoopController {
  private state: LoopState | undefined;
  private persist: Persist = () => {};
  private exhaustedHandlers = new Map<LoopOwner, ExhaustedHandler>();

  configure(persist: Persist): void {
    this.persist = persist;
  }

  setExhaustedHandler(owner: LoopOwner, handler: ExhaustedHandler): void {
    this.exhaustedHandlers.set(owner, handler);
  }

  restore(value: unknown): void {
    this.state = value === undefined ? undefined : validateLoopState(value);
  }

  snapshot(): LoopState | undefined {
    return copyState(this.state);
  }

  start(owner: LoopOwner, task: string, maxTurns: number): LoopState {
    if (this.state?.status === "active")
      throw new Error(`Loop is already active and owned by ${this.state.owner}`);
    if (!task.trim()) throw new Error("task is required");
    if (!Number.isInteger(maxTurns) || maxTurns < 1) throw new Error("maxTurns must be at least 1");
    this.state = {
      version: 1,
      owner,
      task: task.trim(),
      maxTurns,
      turns: 0,
      status: "active",
    };
    this.save();
    return this.snapshot()!;
  }

  updateTask(owner: LoopOwner, task: string): LoopState {
    const state = this.requireOwner(owner);
    if (!task.trim()) throw new Error("task is required");
    state.task = task.trim();
    this.save();
    return this.snapshot()!;
  }

  report(owner: LoopOwner, status: "continue" | "done" | "blocked", summary?: string): LoopState {
    const state = this.requireOwner(owner);
    const cleanSummary = summary?.trim();
    if (status === "continue") {
      state.pendingReport = {
        status: "continue",
        ...(cleanSummary ? { summary: cleanSummary } : {}),
      };
      if (cleanSummary) state.lastSummary = cleanSummary;
    } else {
      state.status = status;
      delete state.pendingReport;
      if (cleanSummary) state.lastSummary = cleanSummary;
      if (status === "blocked" && cleanSummary) state.stopReason = cleanSummary;
    }
    this.save();
    return this.snapshot()!;
  }

  stop(owner: LoopOwner, reason?: string): LoopState {
    const state = this.requireOwner(owner);
    state.status = "stopped";
    delete state.pendingReport;
    if (reason?.trim()) state.stopReason = reason.trim();
    this.save();
    return this.snapshot()!;
  }

  onAgentEnd(): AgentEndResult {
    const state = this.state;
    if (!state || state.status !== "active") return {};

    state.turns += 1;
    const report = state.pendingReport;
    delete state.pendingReport;

    if (state.turns >= state.maxTurns) {
      state.status = "exhausted";
      state.stopReason = `Maximum turn count reached (${state.maxTurns})`;
      this.save();
      const snapshot = this.snapshot()!;
      this.exhaustedHandlers.get(snapshot.owner)?.(snapshot);
      return { exhausted: true };
    }

    const reportInstruction =
      state.owner === "runner"
        ? "Before ending the next turn, call runner.progress with completed steps and/or a concise summary; call runner.finish with evidence only after verifying the requested outcome, or runner.stop if blocked."
        : "Before ending the next turn, call loop with action=report and status=continue, done, or blocked.";
    const reportText = report?.summary
      ? `Previous progress report: ${report.summary}\n\n`
      : report
        ? ""
        : "No completion report was submitted in the previous turn.\n\n";
    const followUp = `${reportText}Continue the active task:\n\n${state.task}\n\n${reportInstruction}`;
    this.save();
    return { followUp };
  }

  private requireOwner(owner: LoopOwner): LoopState {
    const state = this.state;
    if (!state || state.status !== "active") throw new Error("No active loop");
    if (state.owner !== owner)
      throw new Error(
        `Active loop is owned by ${state.owner}; use that owner to report or stop it`,
      );
    return state;
  }

  private save(): void {
    this.persist(this.snapshot());
  }
}

export const loopController = new LoopController();
