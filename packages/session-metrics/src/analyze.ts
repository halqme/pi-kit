import { readFile } from "node:fs/promises";

export { addSkillAvailability } from "./skills.ts";

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
  cost: number;
  cacheCost: number;
}

export interface SkillMetrics {
  reads: number;
  explicit: number;
  existsGlobally?: boolean;
  existsInProject?: boolean;
}

export interface ToolMetrics {
  available?: boolean;
  calls: number;
  estimatedResultTokens: number;
  reportedTokens: number;
  errors: number;
}

export interface MetricSummary {
  sessions: number;
  messages: number;
  userMessages: number;
  assistantMessages: number;
  toolResults: number;
  turns: number;
  toolCalls: number;
  toolCallsByName: Record<string, number>;
  toolUsage: Record<string, ToolMetrics>;
  skills: Record<string, SkillMetrics>;
  models: Record<string, { messages: number; usage: UsageTotals }>;
  thinkingLevels: Record<string, { messages: number; usage: UsageTotals }>;
  modelEfforts: Record<
    string,
    { model: string; effort: string; messages: number; usage: UsageTotals }
  >;
  errors: number;
  tokens: UsageTotals;
}

export interface SessionMetrics extends MetricSummary {
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
}

export interface MetricsReport extends MetricSummary {
  daily: Record<string, MetricSummary>;
  weekly: Record<string, MetricSummary>;
  monthly: Record<string, MetricSummary>;
  projects: Record<string, MetricSummary>;
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
    skills: {},
    models: {},
    thinkingLevels: {},
    modelEfforts: {},
    errors: 0,
    tokens: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 0,
      cost: 0,
      cacheCost: 0,
    },
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

export function analyzeLines(lines: Iterable<string>): SessionMetrics {
  const result = createMetrics();
  let thinkingLevel = "unknown";
  for (const line of lines) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as any;
    if (entry.type === "session") {
      result.sessions++;
      result.sessionId = entry.id;
      result.cwd = entry.cwd;
      result.timestamp = entry.timestamp;
      continue;
    }
    if (entry.type === "thinking_level_change") {
      thinkingLevel = String(entry.thinkingLevel ?? "unknown");
      continue;
    }
    if (entry.type === "turn_end") {
      result.turns++;
      continue;
    }
    if (entry.type !== "message") continue;
    const message = entry.message;
    result.messages++;
    if (message?.role === "user") result.userMessages++;
    if (message?.role === "toolResult") result.toolResults++;
    if (message?.role === "user") {
      const text = (message.content ?? [])
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("\n");
      for (const match of text.matchAll(/(?:^|\s)\/skill:([a-z0-9-]+)/gi)) {
        const skill = (result.skills[match[1]] ??= { reads: 0, explicit: 0 });
        skill.explicit++;
      }
    }
    if (message?.role === "assistant") {
      result.assistantMessages++;
      const usage = message.usage;
      const model = message.model ?? "unknown";
      const modelUsage = (result.models[model] ??= {
        messages: 0,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
          total: 0,
          cost: 0,
          cacheCost: 0,
        },
      });
      modelUsage.messages++;
      const effortUsage = (result.thinkingLevels[thinkingLevel] ??= {
        messages: 0,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
          total: 0,
          cost: 0,
          cacheCost: 0,
        },
      });
      effortUsage.messages++;
      const modelEffortKey = `${model}\0${thinkingLevel}`;
      const modelEffort = (result.modelEfforts[modelEffortKey] ??= {
        model,
        effort: thinkingLevel,
        messages: 0,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
          total: 0,
          cost: 0,
          cacheCost: 0,
        },
      });
      modelEffort.messages++;
      if (usage)
        for (const key of [
          "input",
          "output",
          "cacheRead",
          "cacheWrite",
          "reasoning",
          "totalTokens",
        ] as const) {
          const target = key === "totalTokens" ? "total" : key;
          const value = Number(usage[key] ?? 0);
          result.tokens[target] += value;
          modelUsage.usage[target] += value;
          effortUsage.usage[target] += value;
          modelEffort.usage[target] += value;
        }
      const cost = Number(usage?.cost?.total ?? 0);
      const cacheCost = Number(usage?.cost?.cacheRead ?? 0);
      result.tokens.cost += cost;
      result.tokens.cacheCost += cacheCost;
      modelUsage.usage.cost += cost;
      modelUsage.usage.cacheCost += cacheCost;
      effortUsage.usage.cost += cost;
      effortUsage.usage.cacheCost += cacheCost;
      modelEffort.usage.cost += cost;
      modelEffort.usage.cacheCost += cacheCost;
      for (const block of message.content ?? [])
        if (block.type === "toolCall") {
          result.toolCalls++;
          const tool = (result.toolUsage[block.name] ??= {
            calls: 0,
            estimatedResultTokens: 0,
            reportedTokens: 0,
            errors: 0,
          });
          tool.calls++;
          result.toolCallsByName[block.name] = (result.toolCallsByName[block.name] ?? 0) + 1;
          const args = block.arguments ?? {};
          if (block.name !== "read") continue;
          const path = String(args.path ?? args.file ?? "");
          const match = path.match(/(?:^|[/\\])skills[/\\]([^/\\]+)[/\\]SKILL\.md$/i);
          if (match?.[1]) {
            const skill = (result.skills[match[1]] ??= { reads: 0, explicit: 0 });
            skill.reads++;
          }
        }
    }
    if (message?.role === "toolResult") {
      if (message.isError) result.errors++;
      const tool = (result.toolUsage[message.toolName] ??= {
        calls: 0,
        estimatedResultTokens: 0,
        reportedTokens: 0,
        errors: 0,
      });
      const text = (message.content ?? [])
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("\n");
      tool.estimatedResultTokens += Math.ceil(text.length / 4);
      tool.reportedTokens += Number(message.usage?.totalTokens ?? 0);
      if (message.isError) tool.errors++;
    }
  }
  return result;
}

export async function analyzeFile(path: string): Promise<SessionMetrics> {
  return analyzeLines((await readFile(path, "utf8")).split("\n"));
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

export function mergeMetrics(target: MetricSummary, source: MetricSummary): MetricSummary {
  target.sessions += source.sessions;
  target.messages += source.messages;
  target.userMessages += source.userMessages;
  target.assistantMessages += source.assistantMessages;
  target.toolResults += source.toolResults;
  target.turns += source.turns;
  target.toolCalls += source.toolCalls;
  target.errors += source.errors;
  for (const [name, count] of Object.entries(source.toolCallsByName))
    target.toolCallsByName[name] = (target.toolCallsByName[name] ?? 0) + count;
  for (const [name, usage] of Object.entries(source.toolUsage)) {
    const item = (target.toolUsage[name] ??= {
      available: usage.available ?? false,
      calls: 0,
      estimatedResultTokens: 0,
      reportedTokens: 0,
      errors: 0,
    });
    if (usage.available !== undefined) item.available = usage.available;
    item.calls += usage.calls;
    item.estimatedResultTokens += usage.estimatedResultTokens;
    item.reportedTokens += usage.reportedTokens;
    item.errors += usage.errors;
  }
  for (const [name, skill] of Object.entries(source.skills)) {
    const item = (target.skills[name] ??= {
      reads: 0,
      explicit: 0,
      existsGlobally: skill.existsGlobally ?? false,
      existsInProject: skill.existsInProject ?? false,
    });
    if (skill.existsGlobally !== undefined) item.existsGlobally = skill.existsGlobally;
    if (skill.existsInProject !== undefined) item.existsInProject = skill.existsInProject;
    item.reads += skill.reads;
    item.explicit += skill.explicit;
  }
  for (const [name, model] of Object.entries(source.models)) {
    const item = (target.models[name] ??= {
      messages: 0,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        total: 0,
        cost: 0,
        cacheCost: 0,
      },
    });
    item.messages += model.messages;
    for (const key of Object.keys(item.usage) as (keyof UsageTotals)[])
      item.usage[key] += model.usage[key];
  }
  for (const [name, effort] of Object.entries(source.thinkingLevels)) {
    const item = (target.thinkingLevels[name] ??= {
      messages: 0,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        total: 0,
        cost: 0,
        cacheCost: 0,
      },
    });
    item.messages += effort.messages;
    for (const key of Object.keys(item.usage) as (keyof UsageTotals)[])
      item.usage[key] += effort.usage[key];
  }
  for (const [key, effort] of Object.entries(source.modelEfforts)) {
    const item = (target.modelEfforts[key] ??= {
      model: effort.model,
      effort: effort.effort,
      messages: 0,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        total: 0,
        cost: 0,
        cacheCost: 0,
      },
    });
    item.messages += effort.messages;
    for (const usageKey of Object.keys(item.usage) as (keyof UsageTotals)[])
      item.usage[usageKey] += effort.usage[usageKey];
  }
  for (const key of Object.keys(target.tokens) as (keyof UsageTotals)[])
    target.tokens[key] += source.tokens[key];
  return target;
}
