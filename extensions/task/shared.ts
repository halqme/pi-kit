import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface TextToolResult {
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
}

export function jsonResult(value: unknown): TextToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}
