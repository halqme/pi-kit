import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { UsageTotals } from "./types.ts";

export type SessionEvent =
  | {
      kind: "session";
      id?: string;
      cwd?: string;
      timestamp?: string;
    }
  | {
      kind: "thinking_level";
      level: string;
      timestamp?: string;
    }
  | {
      kind: "turn_end";
      timestamp?: string;
    }
  | {
      kind: "user_message";
      timestamp?: string;
      content: unknown;
    }
  | {
      kind: "assistant_message";
      timestamp?: string;
      provider?: string;
      model?: string;
      thinkingLevel?: string;
      stopReason?: string;
      errorMessage?: string;
      usage: UsageTotals;
    }
  | {
      kind: "tool_call";
      timestamp?: string;
      toolCallId?: string;
      toolName: string;
      input: unknown;
      nested?: true;
    }
  | {
      kind: "tool_result";
      timestamp?: string;
      toolCallId?: string;
      toolName?: string;
      content: unknown;
      details?: unknown;
      isError: boolean;
      reportedTokens: number;
      usage?: UsageTotals;
      nested?: true;
      durationMs?: number;
      nestedCallsIncomplete?: true;
    }
  | {
      kind: "usage";
      timestamp?: string;
      usageKind: string;
      provider?: string;
      model?: string;
      usage: UsageTotals;
    }
  | {
      kind: "other";
      type: string;
      timestamp?: string;
      value: unknown;
    }
  | {
      kind: "invalid_line";
    };

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestamp(entry: RecordValue, message?: RecordValue): string | undefined {
  return string(entry.timestamp) ?? string(message?.timestamp);
}

export function emptyUsage(): UsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    total: 0,
    cost: 0,
    cacheCost: 0,
  };
}

export function normalizeUsage(value: unknown): UsageTotals {
  const usage = record(value);
  const cost = record(usage?.cost);
  return {
    input: numeric(usage?.input),
    output: numeric(usage?.output),
    cacheRead: numeric(usage?.cacheRead),
    cacheWrite: numeric(usage?.cacheWrite),
    reasoning: numeric(usage?.reasoning),
    total: numeric(usage?.totalTokens ?? usage?.total),
    cost: numeric(cost?.total ?? usage?.cost),
    cacheCost: numeric(cost?.cacheRead ?? usage?.cacheCost),
  };
}

export function textContent(value: unknown): string {
  if (!Array.isArray(value)) return typeof value === "string" ? value : "";
  return value
    .map((block) => {
      const item = record(block);
      return item?.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function messageEvents(entry: RecordValue, message: RecordValue): SessionEvent[] {
  const role = string(message.role);
  const eventTimestamp = timestamp(entry, message);
  if (role === "user") {
    return [
      {
        kind: "user_message",
        ...(eventTimestamp ? { timestamp: eventTimestamp } : {}),
        content: message.content,
      },
    ];
  }
  if (role === "assistant") {
    const provider = string(message.provider);
    const model = string(message.model);
    const thinkingLevel = string(message.thinkingLevel);
    const stopReason = string(message.stopReason);
    const errorMessage = string(message.errorMessage);
    const events: SessionEvent[] = [
      {
        kind: "assistant_message",
        ...(eventTimestamp ? { timestamp: eventTimestamp } : {}),
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
        ...(stopReason ? { stopReason } : {}),
        ...(errorMessage ? { errorMessage } : {}),
        usage: normalizeUsage(message.usage),
      },
    ];
    for (const block of Array.isArray(message.content) ? message.content : []) {
      const item = record(block);
      if (item?.type !== "toolCall" || typeof item.name !== "string") continue;
      const toolCallId = string(item.id ?? item.toolCallId);
      events.push({
        kind: "tool_call",
        ...(eventTimestamp ? { timestamp: eventTimestamp } : {}),
        ...(toolCallId ? { toolCallId } : {}),
        toolName: item.name,
        input: item.arguments ?? item.input,
      });
    }
    return events;
  }
  if (role === "toolResult") {
    const toolCallId = string(message.toolCallId);
    const toolName = string(message.toolName);
    const nestedCalls = record(message.nestedCalls);
    const events: SessionEvent[] = [];

    for (const candidate of Array.isArray(nestedCalls?.calls) ? nestedCalls.calls : []) {
      const call = record(candidate);
      const id = string(call?.id);
      const name = string(call?.name);
      if (!call || !id || !name) continue;
      events.push({
        kind: "tool_call",
        ...(eventTimestamp ? { timestamp: eventTimestamp } : {}),
        toolCallId: id,
        toolName: name,
        input: call.arguments,
        nested: true,
      });
      if (call.status !== "ok" && call.status !== "error") continue;
      const durationMs =
        typeof call.durationMs === "number" &&
        Number.isFinite(call.durationMs) &&
        call.durationMs >= 0
          ? call.durationMs
          : undefined;
      const error = string(call.error);
      events.push({
        kind: "tool_result",
        ...(eventTimestamp ? { timestamp: eventTimestamp } : {}),
        toolCallId: id,
        toolName: name,
        content: error ? [{ type: "text", text: error }] : [],
        details: { status: call.status },
        isError: call.status === "error",
        reportedTokens: 0,
        nested: true,
        ...(durationMs !== undefined ? { durationMs } : {}),
      });
    }

    events.push({
      kind: "tool_result",
      ...(eventTimestamp ? { timestamp: eventTimestamp } : {}),
      ...(toolCallId ? { toolCallId } : {}),
      ...(toolName ? { toolName } : {}),
      content: message.content,
      ...(message.details !== undefined ? { details: message.details } : {}),
      isError: message.isError === true,
      reportedTokens: numeric(record(message.usage)?.totalTokens),
      usage: normalizeUsage(message.usage),
      ...(nestedCalls?.complete === false ? { nestedCallsIncomplete: true as const } : {}),
    });
    return events;
  }
  return [
    {
      kind: "other",
      type: role ? `message:${role}` : "message",
      ...(eventTimestamp ? { timestamp: eventTimestamp } : {}),
      value: entry,
    },
  ];
}

export function eventsFromLine(line: string): SessionEvent[] {
  if (!line.trim()) return [];
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return [{ kind: "invalid_line" }];
  }
  const entry = record(value);
  if (!entry) return [{ kind: "invalid_line" }];
  const type = string(entry.type) ?? "unknown";
  const eventTimestamp = timestamp(entry);
  if (type === "session") {
    const id = string(entry.id);
    const cwd = string(entry.cwd);
    return [
      {
        kind: "session",
        ...(id ? { id } : {}),
        ...(cwd ? { cwd } : {}),
        ...(eventTimestamp ? { timestamp: eventTimestamp } : {}),
      },
    ];
  }
  if (type === "thinking_level_change") {
    return [
      {
        kind: "thinking_level",
        level: string(entry.thinkingLevel) ?? "unknown",
        ...(eventTimestamp ? { timestamp: eventTimestamp } : {}),
      },
    ];
  }
  if (type === "turn_end") {
    return [{ kind: "turn_end", ...(eventTimestamp ? { timestamp: eventTimestamp } : {}) }];
  }
  if (type === "usage") {
    const provider = string(entry.provider);
    const model = string(entry.model);
    return [
      {
        kind: "usage",
        ...(eventTimestamp ? { timestamp: eventTimestamp } : {}),
        usageKind: string(entry.kind) ?? "unknown",
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
        usage: normalizeUsage(entry.usage),
      },
    ];
  }
  if (type === "message") {
    const message = record(entry.message);
    return message ? messageEvents(entry, message) : [{ kind: "invalid_line" }];
  }
  return [
    {
      kind: "other",
      type,
      ...(eventTimestamp ? { timestamp: eventTimestamp } : {}),
      value: entry,
    },
  ];
}

export function* eventsFromLines(lines: Iterable<string>): Generator<SessionEvent> {
  for (const line of lines) yield* eventsFromLine(line);
}

export async function* readSessionEvents(path: string): AsyncGenerator<SessionEvent> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) yield* eventsFromLine(line);
}
