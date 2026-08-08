function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Returns the conventional string `action` facet when a tool input exposes one.
 * The analyzer does not know which tool produced the input or what the action means.
 */
export function toolAction(input: unknown): string | undefined {
  const action = record(input)?.action;
  return typeof action === "string" && action.length > 0 ? action : undefined;
}
