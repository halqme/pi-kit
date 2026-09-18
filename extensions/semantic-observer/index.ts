import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createOpenRouterSemanticEvaluator,
  type JsonValue,
  type NoulQuestion,
} from "../../packages/semantic-predicate/src/index.ts";

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
    "Given `request`, `task`, and `changes`, has the work materially moved beyond the requested outcome or the smallest necessary implementation scope?",
    "The changes add behavior, refactoring, dependencies, or scope that is not needed for the request or task contract.",
    "The changes stay within the request or are necessary to satisfy its task contract.",
  ),
  verificationGap: noul(
    "Given `request`, `changes`, and `verification`, is there a meaningful gap between what changed and what the executed verification demonstrates?",
    "Important changed behavior or an important failure mode is not covered by the supplied executed verification.",
    "The supplied executed verification is relevant evidence for the important changed behavior and failure modes.",
  ),
  consistencyRisk: noul(
    "Given `changes` and `repository_evidence`, do the changes appear inconsistent with relevant repository contracts, conventions, or related files?",
    "The supplied repository evidence indicates a material inconsistency or likely integration mismatch.",
    "The changes are consistent with the supplied repository evidence, or the evidence does not indicate a material mismatch.",
  ),
} as const;

type ObservationResult = {
  probability: number;
  stateFields: string[];
  model?: string;
};

const state = (entries: Array<[string, string | undefined]>): JsonValue =>
  Object.fromEntries(
    entries.filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

export default function semanticObserverExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "semantic_observe",
    label: "Semantic Observe",
    description:
      "Run optional, non-authoritative Jev observations over compact evidence. Each judgment receives only the state fields it needs; returned probabilities are advisory and never change task, verification, or completion state.",
    parameters: Type.Object({
      request: Type.String({
        description:
          "The user's requested outcome, preferably copied or minimally normalized rather than paraphrased.",
      }),
      task: Type.Optional(
        Type.String({
          description:
            "Current task contract or acceptance criteria when they materially clarify the request.",
        }),
      ),
      changes: Type.String({
        description:
          "Compact primary evidence about the current changes: changed paths plus the smallest relevant diff excerpts or direct change facts. Prefer evidence over a narrative summary.",
      }),
      verification: Type.Optional(
        Type.String({
          description:
            "Executed verification evidence and results. Do not include planned checks or self-review as if they had run.",
        }),
      ),
      repositoryEvidence: Type.Optional(
        Type.String({
          description:
            "Only repository evidence relevant to consistency: nearby contracts, conventions, related code, or retrieved context. Do not send broad repository dumps.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error("semantic_observe requires OPENROUTER_API_KEY");
      }

      const evaluate = createOpenRouterSemanticEvaluator({ apiKey });
      const calls: Array<Promise<[string, ObservationResult]>> = [];

      calls.push(
        evaluate({
          state: state([
            ["request", params.request],
            ["task", params.task],
            ["changes", params.changes],
          ]),
          questions: { scope_drift: QUESTIONS.scopeDrift },
        }).then((response) => [
          "scopeDrift",
          {
            probability: response.answers.scope_drift.noul,
            stateFields: ["request", ...(params.task ? ["task"] : []), "changes"],
            ...(response.model ? { model: response.model } : {}),
          },
        ] as [string, ObservationResult]),
      );

      if (params.verification !== undefined) {
        calls.push(
          evaluate({
            state: state([
              ["request", params.request],
              ["changes", params.changes],
              ["verification", params.verification],
            ]),
            questions: { verification_gap: QUESTIONS.verificationGap },
          }).then((response) => [
            "verificationGap",
            {
              probability: response.answers.verification_gap.noul,
              stateFields: ["request", "changes", "verification"],
              ...(response.model ? { model: response.model } : {}),
            },
          ] as [string, ObservationResult]),
        );
      }

      if (params.repositoryEvidence !== undefined) {
        calls.push(
          evaluate({
            state: state([
              ["changes", params.changes],
              ["repository_evidence", params.repositoryEvidence],
            ]),
            questions: { consistency_risk: QUESTIONS.consistencyRisk },
          }).then((response) => [
            "consistencyRisk",
            {
              probability: response.answers.consistency_risk.noul,
              stateFields: ["changes", "repository_evidence"],
              ...(response.model ? { model: response.model } : {}),
            },
          ] as [string, ObservationResult]),
        );
      }

      const observations = Object.fromEntries(await Promise.all(calls));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ observations }, null, 2),
          },
        ],
        details: {
          advisory: true,
          observations: Object.keys(observations),
        },
      };
    },
  });
}
