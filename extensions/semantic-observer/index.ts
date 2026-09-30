import {
  Type,
  type ClassifierApi,
  type ClassifierModel,
  type JsonObject,
  type Usage,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildObservationState, type ObservationId } from "./evidence.ts";

const QUESTIONS = {
  scopeDrift: {
    type: "bool",
    instructions:
      "Using `task` as the scope authority and `changes` as runtime evidence, has the work materially moved beyond the requested outcome or the smallest necessary implementation scope? Treat `task.current_stage.working_plan` as a hypothesis, not as authority to expand scope.",
    criteria: {
      true: "The changes add behavior, refactoring, dependencies, or scope that is not needed for the task goal or acceptance criteria.",
      false:
        "The changes stay within the task goal and acceptance criteria, or are necessary to satisfy them.",
    },
  },
  verificationGap: {
    type: "bool",
    instructions:
      "Given `task`, `changes`, and executed `verification`, is there a meaningful gap between what changed and what the executed verification demonstrates?",
    criteria: {
      true: "Important changed behavior or an important failure mode is not covered by the supplied executed verification.",
      false:
        "The supplied executed verification is relevant evidence for the important changed behavior and failure modes.",
    },
  },
  consistencyRisk: {
    type: "bool",
    instructions:
      "Given `changes` and the previously observed `repository_evidence`, do the changes appear inconsistent with relevant repository contracts, conventions, or related code?",
    criteria: {
      true: "The supplied repository evidence indicates a material inconsistency or likely integration mismatch.",
      false:
        "The changes are consistent with the supplied repository evidence, or the evidence does not indicate a material mismatch.",
    },
  },
} as const satisfies Record<
  ObservationId,
  { type: "bool"; instructions: string; criteria: { true: string; false: string } }
>;

type ObservationResult = {
  probability: number;
  model?: string;
  usage?: Usage;
};

type ObservationEvaluation =
  | { ok: true; result: ObservationResult }
  | { ok: false; error: string; usage?: Usage };

const QUESTION_IDS: Record<ObservationId, string> = {
  scopeDrift: "scope_drift",
  verificationGap: "verification_gap",
  consistencyRisk: "consistency_risk",
};

async function evaluateObservation(
  ctx: ExtensionContext,
  model: ClassifierModel<ClassifierApi>,
  observation: ObservationId,
  state: JsonObject,
  signal?: AbortSignal,
): Promise<ObservationEvaluation> {
  const id = QUESTION_IDS[observation];
  const result = await ctx.modelRegistry.classify(
    model,
    { state, questions: { [id]: QUESTIONS[observation] } },
    signal ? { signal } : undefined,
  );
  if (result.stopReason !== "stop" || signal?.aborted) {
    const reason = signal?.aborted ? "aborted" : (result.errorMessage ?? result.stopReason);
    return {
      ok: false,
      error: `execution_failure: Jev classification failed: ${reason}`,
      ...(result.usage ? { usage: result.usage } : {}),
    };
  }
  const answer = result.answers[id];
  if (answer?.type !== "bool") {
    return {
      ok: false,
      error: `execution_failure: Jev returned no boolean answer for ${observation}.`,
      ...(result.usage ? { usage: result.usage } : {}),
    };
  }

  return {
    ok: true,
    result: {
      probability: answer.probability,
      model: result.model,
      ...(result.usage ? { usage: result.usage } : {}),
    },
  };
}

function aggregateUsage(usages: Array<Usage | undefined>): Usage | undefined {
  const present = usages.filter((usage): usage is Usage => usage !== undefined);
  if (present.length === 0) return undefined;
  const sum = (key: "input" | "output" | "cacheRead" | "cacheWrite" | "totalTokens") =>
    present.reduce((total, usage) => total + usage[key], 0);
  const reasoning = present.reduce((total, usage) => total + (usage.reasoning ?? 0), 0);
  const cacheWrite1h = present.reduce((total, usage) => total + (usage.cacheWrite1h ?? 0), 0);
  const cost = {
    input: present.reduce((total, usage) => total + usage.cost.input, 0),
    output: present.reduce((total, usage) => total + usage.cost.output, 0),
    cacheRead: present.reduce((total, usage) => total + usage.cost.cacheRead, 0),
    cacheWrite: present.reduce((total, usage) => total + usage.cost.cacheWrite, 0),
    total: present.reduce((total, usage) => total + usage.cost.total, 0),
  };
  return {
    input: sum("input"),
    output: sum("output"),
    cacheRead: sum("cacheRead"),
    cacheWrite: sum("cacheWrite"),
    totalTokens: sum("totalTokens"),
    cost,
    ...(present.some((usage) => usage.reasoning !== undefined) ? { reasoning } : {}),
    ...(present.some((usage) => usage.cacheWrite1h !== undefined) ? { cacheWrite1h } : {}),
  };
}

export default function semanticObserverExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "semantic_observe",
    label: "Semantic Observe",
    exposure: "deferred",
    description:
      "Run optional, non-authoritative Jev observations over evidence already captured by Pi Kit task, repository, mutation, and verification runtime state. The caller chooses observations, not the evidence payload.",
    parameters: Type.Object({
      observations: Type.Array(
        Type.Union([
          Type.Literal("scopeDrift"),
          Type.Literal("verificationGap"),
          Type.Literal("consistencyRisk"),
        ]),
        {
          minItems: 1,
          maxItems: 3,
          uniqueItems: true,
          description: "Semantic judgments to run against Pi Kit runtime evidence.",
        },
      ),
    }),
    async execute(_toolCallId, params, signal, _update, ctx) {
      const model = ctx.modelRegistry.findOfType("classifier", "typesafe", "jev-latest");
      if (!model) {
        throw new Error(
          "precondition: TypeSafe Jev classifier is unavailable in the model catalog.",
        );
      }

      const results = await Promise.allSettled(
        params.observations.map(async (observation) => {
          const state = await buildObservationState(ctx, observation);
          return {
            observation,
            evaluation: await evaluateObservation(ctx, model, observation, state, signal),
          };
        }),
      );
      const observations: Partial<Record<ObservationId, ObservationResult>> = {};
      const errors: Array<{ observation: ObservationId; error: string }> = [];
      const usages: Array<Usage | undefined> = [];

      for (const [index, result] of results.entries()) {
        if (result.status === "rejected") {
          const observation = params.observations[index]!;
          errors.push({
            observation,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
          continue;
        }

        const { observation, evaluation } = result.value;
        if (evaluation.ok) {
          observations[observation] = evaluation.result;
          usages.push(evaluation.result.usage);
        } else {
          errors.push({ observation, error: evaluation.error });
          usages.push(evaluation.usage);
        }
      }

      const usage = aggregateUsage(usages);
      const response = { observations, ...(errors.length > 0 ? { errors } : {}) };
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(response, null, 2),
          },
        ],
        details: {
          advisory: true,
          evidenceSource: "pi-runtime",
          observations: Object.keys(observations),
          ...(errors.length > 0 ? { errors } : {}),
        },
        ...(errors.length > 0 ? { isError: true } : {}),
        ...(usage ? { usage } : {}),
      };
    },
  });
}
