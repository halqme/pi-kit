import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const TASK_ENTRY = "task-state";
export const VERIFY_ENTRY = "verification-evidence";

export interface TextToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: unknown;
}

export function jsonResult(value: unknown): TextToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    details: undefined,
  };
}

export function latestCustom<T>(ctx: ExtensionContext, customType: string): T | undefined {
  for (const candidate of [...ctx.sessionManager.getEntries()].reverse()) {
    if (!candidate || typeof candidate !== "object") continue;
    const entry = candidate as { type?: unknown; customType?: unknown; data?: unknown };
    if (entry.type === "custom" && entry.customType === customType) return entry.data as T;
  }
  return undefined;
}

export function customEntries<T>(ctx: ExtensionContext, customType: string): T[] {
  return ctx.sessionManager.getEntries().flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const entry = candidate as { type?: unknown; customType?: unknown; data?: unknown };
    return entry.type === "custom" && entry.customType === customType ? [entry.data as T] : [];
  });
}
