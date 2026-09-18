import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createOpenRouterSemanticEvaluator,
  type JsonValue,
  type NoulQuestion,
  type SemanticEvaluator,
} from "../../packages/semantic-predicate/src/index.ts";
import { buildObservationState, type ObservationId } from "./evidence.ts";

const noul = (
  instructions: string,
  yes: string,
  no: string,
): NoulQuestion => ({
  type: "noul",
  instructions,
  criteria: {
    true: yes,
    false: no,
  },
});

const QUESTIONS = {
  scopeDrift: noul(
    "Using `task` as the scope authority and `changes` as runtime evidence, has the work materially moved beyond the requested outcome or the smallest necessary implementation scope? Treat `task.current_stage.working_plan` as a hypothesis, not as authority to expand scope.",
    "The changes add behavior, refactoring, dependencies, or scope that is not needed for the task goal or acceptance criteria.",
    "The changes stay within the task goal and acceptance criteria, or are necessary to satisfy them.",
  ),
  verificationGap: noul(
    "Given `task`, `changes`, and executed `verification`, is there a meaningful gap between what changed and what the executed verification demonstrates?",
    "Important changed behavior or an important failure mode is not covered by the supplied executed verification.",
    "The supplied executed verification is relevant evidence for the important changed behavior and failure modes.",
  ),
  consistencyRisk: noul(
    "Given `changes` and the previously observed `repository_evidence`, do the changes appear inconsistent with relevant repository contracts, conventions, or related code?",
    "The supplied repository evidence indicates a material inconsistency or likely integration mismatch.",
    "The changes are consistent with the supplied repository evidence, or the evidence does not indicate a material mismatch.",
  ),
} as const;

type ObservationResult = {
  probability: number;
  model?: string;
};

async function evaluateObservation(
  evaluate: SemanticEvaluator,
  observation: ObservationId,
  state: JsonValue,
): Promise<ObservationResult> {
  if (observation === "scopeDrift") {
    const response = await evaluate({
      state,
      questions: { scope_drift: QUESTIONS.scopeDrift },
    });
    return {
      probability: response.answers.scope_drift.noul,
      ...(response.model ? { model: response.model } : {}),
    };
  }

  if (observation === "verificationGap") {
    const response = await evaluate({
      state,
      questions: { verification_gap: QUESTIONS.verificationGap },
    });
    return {
      probability: response.answers.verification_gap.noul,
      ...(response.model ? { model: response.model } : {}),
    };
  }

  const response = await evaluate({
    state,
    questions: { consistency_risk: QUESTIONS.consistencyRisk },
  });
  return {
    probability: response.answers.consistency_risk.noul,
    ...(response.model ? { model: response.model } : {}),
  };
}

export default function semanticObserverExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "semantic_observe",
    label: "Semantic Observe",
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
    async execute(_toolCallId, params, _signal, _update, ctx) {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error("semantic_observe requires OPENROUTER_API_KEY");
      }

      const evaluate = createOpenRouterSemanticEvaluator({ apiKey });
      const observations = Object.fromEntries(
        await Promise.all(
          params.observations.map(async (observation) => {
            const state = await buildObservationState(ctx, observation);
            return [observation, await evaluateObservation(evaluate, observation, state)] as const;
          }),
        ),
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ observations }, null, 2),
          },
        ],
        details: {
          advisory: true,
          evidenceSource: "pi-runtime",
          observations: Object.keys(observations),
        },
      };
    },
  });
}
