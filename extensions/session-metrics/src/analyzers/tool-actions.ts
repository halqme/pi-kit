function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Returns the explicit string `action` facet, or the tool name for the default action.
 * The analyzer does not interpret the action's meaning.
 */
export function toolAction(toolName: string, input: unknown): string {
  const action = record(input)?.action;
  return typeof action === "string" && action.length > 0 ? action : toolName;
}
