import { readFile } from "node:fs/promises";

export interface UsageTotals { input: number; output: number; cacheRead: number; cacheWrite: number; total: number; cost: number; }
export interface SessionMetrics {
  sessions: number;
  sessionId?: string;
  cwd?: string;
  messages: number;
  assistantMessages: number;
  turns: number;
  toolCalls: number;
  toolCallsByName: Record<string, number>;
  toolUsage: Record<string, { calls: number; estimatedResultTokens: number; reportedTokens: number }>;
  skills: Record<string, { loads: number; explicit: number; inferred: number }>;
  models: Record<string, { messages: number; usage: UsageTotals }>;
  errors: number;
  tokens: UsageTotals;
}

export function createMetrics(): SessionMetrics {
  return { sessions: 0, messages: 0, assistantMessages: 0, turns: 0, toolCalls: 0, toolCallsByName: {}, toolUsage: {}, skills: {}, models: {}, errors: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 } };
}

export function analyzeLines(lines: Iterable<string>): SessionMetrics {
  const result = createMetrics();
  for (const line of lines) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as any;
    if (entry.type === "session") { result.sessions++; result.sessionId = entry.id; result.cwd = entry.cwd; continue; }
    if (entry.type === "turn_end") { result.turns++; continue; }
    if (entry.type !== "message") continue;
    const message = entry.message;
    result.messages++;
    if (message?.role === "assistant") {
      result.assistantMessages++;
      const usage = message.usage;
      const model = message.model ?? "unknown";
      const modelUsage = result.models[model] ??= { messages: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 } };
      modelUsage.messages++;
      if (usage) for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) {
        const target = key === "totalTokens" ? "total" : key;
        const value = Number(usage[key] ?? 0);
        result.tokens[target] += value;
        modelUsage.usage[target] += value;
      }
      const cost = Number(usage?.cost?.total ?? 0);
      result.tokens.cost += cost;
      modelUsage.usage.cost += cost;
      for (const block of message.content ?? []) if (block.type === "toolCall") {
        result.toolCalls++;
        const tool = result.toolUsage[block.name] ??= { calls: 0, estimatedResultTokens: 0, reportedTokens: 0 };
        tool.calls++;
        result.toolCallsByName[block.name] = (result.toolCallsByName[block.name] ?? 0) + 1;
        const args = block.arguments ?? {};
        const path = String(args.path ?? args.file ?? "");
        const match = path.match(/(?:^|[/\\])skills[/\\]([^/\\]+)[/\\]SKILL\.md$/i);
        if (match?.[1]) {
          const skill = result.skills[match[1]] ??= { loads: 0, explicit: 0, inferred: 0 };
          skill.loads++;
          if (String(args.command ?? "").includes("/skill:")) skill.explicit++;
          else skill.inferred++;
        }
      }
    }
    if (message?.role === "toolResult") {
      if (message.isError) result.errors++;
      const tool = result.toolUsage[message.toolName] ??= { calls: 0, estimatedResultTokens: 0, reportedTokens: 0 };
      const text = (message.content ?? []).filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n");
      tool.estimatedResultTokens += Math.ceil(text.length / 4);
      tool.reportedTokens += Number(message.usage?.totalTokens ?? 0);
    }
  }
  return result;
}

export async function analyzeFile(path: string): Promise<SessionMetrics> {
  return analyzeLines((await readFile(path, "utf8")).split("\n"));
}

export function mergeMetrics(target: SessionMetrics, source: SessionMetrics): SessionMetrics {
  target.sessions += source.sessions;
  target.messages += source.messages;
  target.assistantMessages += source.assistantMessages;
  target.turns += source.turns;
  target.toolCalls += source.toolCalls;
  target.errors += source.errors;
  for (const [name, count] of Object.entries(source.toolCallsByName)) target.toolCallsByName[name] = (target.toolCallsByName[name] ?? 0) + count;
  for (const [name, usage] of Object.entries(source.toolUsage)) {
    const item = target.toolUsage[name] ??= { calls: 0, estimatedResultTokens: 0, reportedTokens: 0 };
    item.calls += usage.calls; item.estimatedResultTokens += usage.estimatedResultTokens; item.reportedTokens += usage.reportedTokens;
  }
  for (const [name, skill] of Object.entries(source.skills)) {
    const item = target.skills[name] ??= { loads: 0, explicit: 0, inferred: 0 };
    item.loads += skill.loads; item.explicit += skill.explicit; item.inferred += skill.inferred;
  }
  for (const [name, model] of Object.entries(source.models)) {
    const item = target.models[name] ??= { messages: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 } };
    item.messages += model.messages;
    for (const key of Object.keys(item.usage) as (keyof UsageTotals)[]) item.usage[key] += model.usage[key];
  }
  for (const key of Object.keys(target.tokens) as (keyof UsageTotals)[]) target.tokens[key] += source.tokens[key];
  return target;
}
