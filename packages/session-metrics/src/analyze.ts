import { explicitSkillNames, skillNameFromRead, skillReadPath } from "./analyzers/skills.ts";
import { toolAction } from "./analyzers/tool-actions.ts";
import { vnextFacet, type VnextFacet } from "./analyzers/vnext.ts";
import {
  emptyUsage,
  eventsFromLines,
  readSessionEvents,
  textContent,
  type SessionEvent,
} from "./events.ts";
import type {
  MetricsReport,
  MetricSummary,
  RuntimeOperationMetrics,
  SessionMetrics,
  SkillMetrics,
  ToolMetrics,
  UsageTotals,
  VerificationProvenanceMetrics,
  VnextRuntimeMetrics,
} from "./types.ts";

export type {
  MetricsReport,
  MetricSummary,
  RuntimeOperationMetrics,
  SessionMetrics,
  SkillMetrics,
  ToolMetrics,
  UsageTotals,
  VerificationProvenanceMetrics,
  VnextRuntimeMetrics,
} from "./types.ts";

function createToolMetrics(): ToolMetrics {
  return {
    calls: 0,
    estimatedResultTokens: 0,
    reportedTokens: 0,
    errors: 0,
    completedCalls: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
  };
}

function createRuntimeOperationMetrics(): RuntimeOperationMetrics {
  return { calls: 0, errors: 0, actions: {} };
}

function createVnextMetrics(): VnextRuntimeMetrics {
  return {
    context: createRuntimeOperationMetrics(),
    code: createRuntimeOperationMetrics(),
    task: createRuntimeOperationMetrics(),
    delegate: createRuntimeOperationMetrics(),
    verify: createRuntimeOperationMetrics(),
    verification: { records: 0, passed: 0, failed: 0, byProvenance: {} },
  };
}

function createSkillMetrics(): SkillMetrics {
  return { reads: 0, explicit: 0 };
}

function addUsage(target: UsageTotals, source: UsageTotals): void {
  for (const key of Object.keys(target) as (keyof UsageTotals)[]) target[key] += source[key];
}

export function createMetrics(): SessionMetrics {
  return {
    sessions: 0,
    messages: 0,
    userMessages: 0,
    assistantMessages: 0,
    toolResults: 0,
    turns: 0,
    toolCalls: 0,
    toolCallsByName: {},
    toolUsage: {},
    toolActions: {},
    logicalOperations: {
      operations: 0,
      toolCalls: 0,
      returnedTokens: 0,
      wallClockMs: 0,
      errors: 0,
      retries: 0,
      successes: 0,
    },
    vnext: createVnextMetrics(),
    skills: {},
    models: {},
    thinkingLevels: {},
    modelEfforts: {},
    toolErrors: 0,
    modelErrors: 0,
    errors: 0,
    invalidLines: 0,
    tokens: emptyUsage(),
  };
}

export function createReport(): MetricsReport {
  return {
    ...createMetrics(),
    daily: {},
    weekly: {},
    monthly: {},
    projects: {},
  };
}

function timestampMs(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function addToolResult(
  tool: ToolMetrics,
  event: Extract<SessionEvent, { kind: "tool_result" }>,
  durationMs?: number,
): void {
  tool.estimatedResultTokens += Math.ceil(textContent(event.content).length / 4);
  tool.reportedTokens += event.reportedTokens;
  if (event.isError) tool.errors++;
  if (durationMs !== undefined) {
    tool.completedCalls++;
    tool.totalDurationMs += durationMs;
    tool.maxDurationMs = Math.max(tool.maxDurationMs, durationMs);
  }
}

function addVnextCall(metrics: VnextRuntimeMetrics, facet: VnextFacet): void {
  const area = metrics[facet.area];
  area.calls++;
  const action = (area.actions[facet.action] ??= { calls: 0, errors: 0 });
  action.calls++;
}

function provenanceMetrics(
  metrics: VnextRuntimeMetrics,
  provenance: string,
): VerificationProvenanceMetrics {
  return (metrics.verification.byProvenance[provenance] ??= {
    records: 0,
    passed: 0,
    failed: 0,
    errors: 0,
  });
}

function recordVerificationResult(
  metrics: VnextRuntimeMetrics,
  facet: VnextFacet,
  passed: boolean,
): void {
  metrics.verification.records++;
  if (passed) metrics.verification.passed++;
  else metrics.verification.failed++;
  if (!facet.provenance) return;
  const provenance = provenanceMetrics(metrics, facet.provenance);
  provenance.records++;
  if (passed) provenance.passed++;
  else provenance.failed++;
}

function addVnextResult(
  metrics: VnextRuntimeMetrics,
  facet: VnextFacet,
  event: Extract<SessionEvent, { kind: "tool_result" }>,
): void {
  const area = metrics[facet.area];
  const action = (area.actions[facet.action] ??= { calls: 0, errors: 0 });
  if (event.isError) {
    area.errors++;
    action.errors++;
    if (facet.area === "verify" && facet.provenance) {
      provenanceMetrics(metrics, facet.provenance).errors++;
    }
    if (facet.area === "verify" && facet.action === "run") {
      recordVerificationResult(metrics, facet, false);
    }
    return;
  }
  if (facet.area !== "verify") return;
  if (facet.action === "run") {
    recordVerificationResult(metrics, facet, true);
    return;
  }
  if (facet.action === "record" && facet.passed !== undefined) {
    recordVerificationResult(metrics, facet, facet.passed);
  }
}

function createAccumulator() {
  const result = createMetrics();
  let thinkingLevel = "unknown";
  let explicitTurnEnds = 0;
  let inferredTurnEnds = 0;
  let operationStartedAt: number | undefined;
  let operationLastAt: number | undefined;
  let operationErrors = 0;
  let operationRetries = 0;
  let operationToolCalls = 0;
  let operationReturnedTokens = 0;
  const pendingTools = new Map<
    string,
    {
      toolName: string;
      action?: string;
      skillPath?: string;
      timestampMs?: number;
      vnext?: VnextFacet;
    }
  >();

  const push = (event: SessionEvent): void => {
    if (event.kind === "invalid_line") {
      result.invalidLines++;
      return;
    }
    if (event.kind === "session") {
      result.sessions++;
      if (event.id) result.sessionId = event.id;
      if (event.cwd) result.cwd = event.cwd;
      if (event.timestamp) result.timestamp = event.timestamp;
      return;
    }
    if (event.kind === "thinking_level") {
      thinkingLevel = event.level;
      return;
    }
    if (event.kind === "turn_end") {
      const at = timestampMs(event.timestamp);
      if (at !== undefined) operationLastAt = at;
      explicitTurnEnds++;
      if (operationStartedAt !== undefined) {
        result.logicalOperations.operations++;
        result.logicalOperations.toolCalls += operationToolCalls;
        result.logicalOperations.returnedTokens += operationReturnedTokens;
        result.logicalOperations.errors += operationErrors;
        result.logicalOperations.retries += operationRetries;
        result.logicalOperations.successes += operationErrors === 0 ? 1 : 0;
        if (operationLastAt !== undefined)
          result.logicalOperations.wallClockMs += operationLastAt - operationStartedAt;
        operationStartedAt = undefined;
        operationLastAt = undefined;
        operationErrors = operationRetries = operationToolCalls = operationReturnedTokens = 0;
      }
      return;
    }
    if (event.kind === "user_message") {
      result.messages++;
      result.userMessages++;
      for (const name of explicitSkillNames(event.content)) {
        (result.skills[name] ??= createSkillMetrics()).explicit++;
      }
      return;
    }
    if (event.kind === "assistant_message") {
      const at = timestampMs(event.timestamp);
      if (operationStartedAt === undefined && at !== undefined) operationStartedAt = at;
      if (at !== undefined) operationLastAt = at;
      result.messages++;
      result.assistantMessages++;
      if (event.stopReason === "stop") inferredTurnEnds++;
      if (event.stopReason === "error") {
        result.modelErrors++;
        result.errors++;
      }
      const provider = event.provider ?? "unknown";
      const model = event.model ?? "unknown";
      const modelUsage = (result.models[model] ??= { messages: 0, usage: emptyUsage() });
      modelUsage.messages++;
      addUsage(modelUsage.usage, event.usage);
      const effortUsage = (result.thinkingLevels[thinkingLevel] ??= {
        messages: 0,
        usage: emptyUsage(),
      });
      effortUsage.messages++;
      addUsage(effortUsage.usage, event.usage);
      const modelEffortKey = `${provider}\0${model}\0${thinkingLevel}`;
      const modelEffort = (result.modelEfforts[modelEffortKey] ??= {
        provider,
        model,
        effort: thinkingLevel,
        messages: 0,
        usage: emptyUsage(),
      });
      modelEffort.messages++;
      addUsage(modelEffort.usage, event.usage);
      addUsage(result.tokens, event.usage);
      return;
    }
    if (event.kind === "tool_call") {
      operationToolCalls++;
      if (operationErrors > operationRetries) operationRetries++;
      const at = timestampMs(event.timestamp);
      if (operationStartedAt === undefined && at !== undefined) operationStartedAt = at;
      if (at !== undefined) operationLastAt = at;
      result.toolCalls++;
      result.toolCallsByName[event.toolName] = (result.toolCallsByName[event.toolName] ?? 0) + 1;
      const tool = (result.toolUsage[event.toolName] ??= createToolMetrics());
      tool.calls++;
      const action = toolAction(event.toolName, event.input);
      if (action) {
        const actions = (result.toolActions[event.toolName] ??= {});
        (actions[action] ??= createToolMetrics()).calls++;
      }
      const runtimeFacet = vnextFacet(event.toolName, event.input);
      if (runtimeFacet) addVnextCall(result.vnext, runtimeFacet);
      if (event.toolCallId) {
        const startedAt = timestampMs(event.timestamp);
        const skillPath = skillReadPath(event.toolName, event.input);
        pendingTools.set(event.toolCallId, {
          toolName: event.toolName,
          ...(action ? { action } : {}),
          ...(skillPath ? { skillPath } : {}),
          ...(startedAt !== undefined ? { timestampMs: startedAt } : {}),
          ...(runtimeFacet ? { vnext: runtimeFacet } : {}),
        });
      }
      return;
    }
    if (event.kind === "tool_result") {
      const at = timestampMs(event.timestamp);
      if (at !== undefined) operationLastAt = at;
      operationReturnedTokens +=
        event.reportedTokens || Math.ceil(textContent(event.content).length / 4);
      if (event.isError) operationErrors++;
      result.messages++;
      result.toolResults++;
      const pending = event.toolCallId ? pendingTools.get(event.toolCallId) : undefined;
      const toolName = event.toolName ?? pending?.toolName ?? "unknown";
      const endedAt = timestampMs(event.timestamp);
      const durationMs =
        pending?.timestampMs !== undefined &&
        endedAt !== undefined &&
        endedAt >= pending.timestampMs
          ? endedAt - pending.timestampMs
          : undefined;
      addToolResult((result.toolUsage[toolName] ??= createToolMetrics()), event, durationMs);
      if (pending?.action) {
        const action = (result.toolActions[toolName] ??= {})[pending.action];
        if (action) addToolResult(action, event, durationMs);
      }
      if (pending?.vnext) addVnextResult(result.vnext, pending.vnext, event);
      if (!event.isError && pending?.skillPath) {
        const name = skillNameFromRead(pending.skillPath, event.content);
        (result.skills[name] ??= createSkillMetrics()).reads++;
      }
      if (event.isError) {
        result.toolErrors++;
        result.errors++;
      }
      if (event.toolCallId) pendingTools.delete(event.toolCallId);
    }
  };

  return {
    push,
    finish(): SessionMetrics {
      result.turns = explicitTurnEnds > 0 ? explicitTurnEnds : inferredTurnEnds;
      if (operationStartedAt !== undefined) {
        result.logicalOperations.operations++;
        result.logicalOperations.toolCalls += operationToolCalls;
        result.logicalOperations.returnedTokens += operationReturnedTokens;
        result.logicalOperations.errors += operationErrors;
        result.logicalOperations.retries += operationRetries;
        result.logicalOperations.successes += operationErrors === 0 ? 1 : 0;
        if (operationLastAt !== undefined)
          result.logicalOperations.wallClockMs += operationLastAt - operationStartedAt;
      }
      return result;
    },
  };
}

export function analyzeEvents(events: Iterable<SessionEvent>): SessionMetrics {
  const accumulator = createAccumulator();
  for (const event of events) accumulator.push(event);
  return accumulator.finish();
}

export function analyzeLines(lines: Iterable<string>): SessionMetrics {
  return analyzeEvents(eventsFromLines(lines));
}

export async function analyzeFile(path: string): Promise<SessionMetrics> {
  const accumulator = createAccumulator();
  for await (const event of readSessionEvents(path)) accumulator.push(event);
  return accumulator.finish();
}

function isoWeekKey(timestamp: string): string {
  const date = new Date(timestamp);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function periodKeys(
  timestamp: string,
): { daily: string; weekly: string; monthly: string } | undefined {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return undefined;
  return {
    daily: date.toISOString().slice(0, 10),
    weekly: isoWeekKey(timestamp),
    monthly: date.toISOString().slice(0, 7),
  };
}

export function addToReport(report: MetricsReport, session: SessionMetrics): MetricsReport {
  mergeMetrics(report, session);
  const periods = session.timestamp && periodKeys(session.timestamp);
  if (periods) {
    mergeMetrics((report.daily[periods.daily] ??= createMetrics()), session);
    mergeMetrics((report.weekly[periods.weekly] ??= createMetrics()), session);
    mergeMetrics((report.monthly[periods.monthly] ??= createMetrics()), session);
  }
  mergeMetrics((report.projects[session.cwd ?? "(unknown)"] ??= createMetrics()), session);
  return report;
}

function mergeToolMetrics(target: ToolMetrics, source: ToolMetrics): void {
  target.calls += source.calls;
  target.estimatedResultTokens += source.estimatedResultTokens;
  target.reportedTokens += source.reportedTokens;
  target.errors += source.errors;
  target.completedCalls += source.completedCalls;
  target.totalDurationMs += source.totalDurationMs;
  target.maxDurationMs = Math.max(target.maxDurationMs, source.maxDurationMs);
}

function mergeRuntimeOperationMetrics(
  target: RuntimeOperationMetrics,
  source: RuntimeOperationMetrics,
): void {
  target.calls += source.calls;
  target.errors += source.errors;
  for (const [actionName, action] of Object.entries(source.actions)) {
    const item = (target.actions[actionName] ??= { calls: 0, errors: 0 });
    item.calls += action.calls;
    item.errors += action.errors;
  }
}

function mergeVnextMetrics(target: VnextRuntimeMetrics, source: VnextRuntimeMetrics): void {
  mergeRuntimeOperationMetrics(target.context, source.context);
  mergeRuntimeOperationMetrics(target.code, source.code);
  mergeRuntimeOperationMetrics(target.task, source.task);
  mergeRuntimeOperationMetrics(target.delegate, source.delegate);
  mergeRuntimeOperationMetrics(target.verify, source.verify);
  target.verification.records += source.verification.records;
  target.verification.passed += source.verification.passed;
  target.verification.failed += source.verification.failed;
  for (const [name, provenance] of Object.entries(source.verification.byProvenance)) {
    const item = (target.verification.byProvenance[name] ??= {
      records: 0,
      passed: 0,
      failed: 0,
      errors: 0,
    });
    item.records += provenance.records;
    item.passed += provenance.passed;
    item.failed += provenance.failed;
    item.errors += provenance.errors;
  }
}

export function mergeMetrics(target: MetricSummary, source: MetricSummary): MetricSummary {
  target.sessions += source.sessions;
  target.messages += source.messages;
  target.userMessages += source.userMessages;
  target.assistantMessages += source.assistantMessages;
  target.toolResults += source.toolResults;
  target.turns += source.turns;
  target.toolCalls += source.toolCalls;
  target.toolErrors += source.toolErrors;
  target.modelErrors += source.modelErrors;
  target.logicalOperations.operations += source.logicalOperations.operations;
  target.logicalOperations.toolCalls += source.logicalOperations.toolCalls;
  target.logicalOperations.returnedTokens += source.logicalOperations.returnedTokens;
  target.logicalOperations.wallClockMs += source.logicalOperations.wallClockMs;
  target.logicalOperations.errors += source.logicalOperations.errors;
  target.logicalOperations.retries += source.logicalOperations.retries;
  target.logicalOperations.successes += source.logicalOperations.successes;
  mergeVnextMetrics(target.vnext, source.vnext);
  target.errors += source.errors;
  target.invalidLines += source.invalidLines;
  for (const [name, count] of Object.entries(source.toolCallsByName))
    target.toolCallsByName[name] = (target.toolCallsByName[name] ?? 0) + count;
  for (const [name, usage] of Object.entries(source.toolUsage))
    mergeToolMetrics((target.toolUsage[name] ??= createToolMetrics()), usage);
  for (const [toolName, actions] of Object.entries(source.toolActions)) {
    const targetActions = (target.toolActions[toolName] ??= {});
    for (const [actionName, usage] of Object.entries(actions))
      mergeToolMetrics((targetActions[actionName] ??= createToolMetrics()), usage);
  }
  for (const [name, skill] of Object.entries(source.skills)) {
    const targetSkill = (target.skills[name] ??= createSkillMetrics());
    targetSkill.reads += skill.reads;
    targetSkill.explicit += skill.explicit;
  }
  for (const [name, model] of Object.entries(source.models)) {
    const item = (target.models[name] ??= { messages: 0, usage: emptyUsage() });
    item.messages += model.messages;
    addUsage(item.usage, model.usage);
  }
  for (const [name, effort] of Object.entries(source.thinkingLevels)) {
    const item = (target.thinkingLevels[name] ??= { messages: 0, usage: emptyUsage() });
    item.messages += effort.messages;
    addUsage(item.usage, effort.usage);
  }
  for (const [key, effort] of Object.entries(source.modelEfforts)) {
    const item = (target.modelEfforts[key] ??= {
      provider: effort.provider,
      model: effort.model,
      effort: effort.effort,
      messages: 0,
      usage: emptyUsage(),
    });
    item.messages += effort.messages;
    addUsage(item.usage, effort.usage);
  }
  addUsage(target.tokens, source.tokens);
  return target;
}
