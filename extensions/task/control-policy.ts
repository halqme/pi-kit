import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type ControlPolicy = "lean" | "robust";

export interface ModelSet {
  include(value: string): ModelSet;
  is(value: string): ModelSet;
  exclude(value: string): ModelSet;
  matches(modelId: string): boolean;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function modelSet(): ModelSet {
  const includes = new Set<string>();
  const exact = new Set<string>();
  const excludes = new Set<string>();

  const set: ModelSet = {
    include(value) {
      includes.add(normalize(value));
      return set;
    },
    is(value) {
      exact.add(normalize(value));
      return set;
    },
    exclude(value) {
      excludes.add(normalize(value));
      return set;
    },
    matches(modelId) {
      const model = normalize(modelId);
      if ([...excludes].some((value) => model.includes(value))) return false;
      return exact.has(model) || [...includes].some((value) => model.includes(value));
    },
  };

  return set;
}

const LEAN_MODELS = modelSet()
  .include("astra")
  .include("sol")
  .include("fable")
  .include("opus");

const ROBUST_MODELS = modelSet()
  .include("luna")
  .include("sonnet")
  .include("haiku")
  .include("flash")
  .include("lite")
  .include("free");

export const ROBUST_CONTROL_GUIDANCE = [
  "Pi Kit control policy: robust.",
  "For non-trivial implementation work, start `task` before mutation and keep its completion contract authoritative.",
  "Use task checkpoints only when understanding or the plan materially changes.",
].join(" ");

export function resolveControlPolicy(
  modelId: string | undefined,
  override = process.env.PI_KIT_CONTROL_POLICY,
): ControlPolicy {
  const configured = override?.trim().toLowerCase();
  if (configured === "lean" || configured === "robust") return configured;
  if (!modelId) return "robust";
  if (ROBUST_MODELS.matches(modelId)) return "robust";
  if (LEAN_MODELS.matches(modelId)) return "lean";
  return "robust";
}

export function registerControlPolicy(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event, ctx) => {
    if (resolveControlPolicy(ctx.model?.id) === "lean") return undefined;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${ROBUST_CONTROL_GUIDANCE}`,
    };
  });
}
