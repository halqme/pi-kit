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
