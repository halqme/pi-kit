export type VnextArea = "context" | "code" | "task" | "delegate" | "verify";

export interface VnextFacet {
  area: VnextArea;
  action: string;
  provenance?: string;
  passed?: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function vnextFacet(toolName: string, input: unknown): VnextFacet | undefined {
  if (!(["context", "code", "task", "delegate", "verify"] as const).includes(toolName as VnextArea)) {
    return undefined;
  }
  const data = record(input);
  const action = data?.action;
  if (typeof action !== "string" || action.length === 0) return undefined;
  if (toolName !== "verify" || (action !== "record" && action !== "run")) {
    return { area: toolName as VnextArea, action };
  }

  const provenance = data?.provenance;
  const passed = data?.passed;
  return {
    area: "verify",
    action,
    ...(typeof provenance === "string" && provenance.length > 0 ? { provenance } : {}),
    ...(action === "record" && typeof passed === "boolean" ? { passed } : {}),
  };
}
