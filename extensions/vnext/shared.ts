export type TextToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
};

export function jsonResult(value: unknown, details?: unknown): TextToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    ...(details === undefined ? {} : { details }),
  };
}
