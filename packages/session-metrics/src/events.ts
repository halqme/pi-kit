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
      model?: string;
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

function number(value: unknown): number {
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
    input: number(usage?.input),
    output: number(usage?.output),
    cacheRead: number(usage?.cacheRead),
    cacheWrite: number(usage?.cacheWrite),
    reasoning: number(usage?.reasoning),
    total: number(usage?.totalTokens ?? usage?.total),
    cost: number(cost?.total ?? usage?.cost),
    cacheCost: number(cost?.cacheRead ?? usage?.cacheCost),
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
    return [{ kind: "user_message", ...(eventTimestamp ? { timestamp: eventTimestamp } : {}), content: message.content }];
  }
  if (role === "assistant") {
    const events: SessionEvent[] = [
      {
        kind: "assistant_message",
        ...(eventTimestamp ? { timestamp: eventTimestamp } : {}),
        ...(string(message.model) ? { model: string(message.model) } : {}),
        ...(string(message.stopReason) ? { stopReason: string(message.stopReason) } : {}),
        ...(string(message.errorMessage) ? { errorMessage: string(message.errorMessage) } : {}),
        usage: normalizeUsage(message.usage),
      },
    ];
    for (const block of Array.isArray(message.content) ? message.content : []) {
      const item = record(block);
      if (item?.type !== "toolCall" || typeof item.name !== "string") continue;
      events.push({
        kind: "tool_call",
        ...(eventTimestamp ? { timestamp: eventTimestamp } : {}),
        ...(string(item.id ?? item.toolCallId) ? { toolCallId: string(item.id ?? item.toolCallId) } : {}),
        toolName: item.name,
        input: item.arguments ?? item.input,
      });
    }
    return events;
  }
  if (role === "toolResult") {
    return [
      {
        kind: "tool_result",
        ...(eventTimestamp ? { timestamp: eventTimestamp } : {}),
        ...(string(message.toolCallId) ? { toolCallId: string(message.toolCallId) } : {}),
        ...(string(message.toolName) ? { toolName: string(message.toolName) } : {}),
        content: message.content,
        ...(message.details !== undefined ? { details: message.details } : {}),
        isError: message.isError === true,
        reportedTokens: number(record(message.usage)?.totalTokens),
      },
    ];
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
    return [
      {
        kind: "session",
        ...(string(entry.id) ? { id: string(entry.id) } : {}),
        ...(string(entry.cwd) ? { cwd: string(entry.cwd) } : {}),
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
