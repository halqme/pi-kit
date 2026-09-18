import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createOpenRouterSemanticEvaluator } from "@halqme/semantic-predicate";

const DEFAULT_PREDICATES = {
  scopeDrift: {
    description:
      "Has the work materially moved beyond the user's requested outcome or the smallest necessary implementation scope?",
  },
  missingEvidence: {
    description:
      "Is the current claim of completion missing relevant executed verification evidence?",
  },
  consistencyRisk: {
    description:
      "Do the described changes appear inconsistent with nearby repository conventions, contracts, or related files?",
  },
} as const;

export default function semanticObserverExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "semantic_observe",
    label: "Semantic Observe",
    description:
      "Run an optional, non-authoritative semantic observation over supplied state. Results are advisory only and never change task, verification, or completion state.",
    parameters: Type.Object({
      state: Type.String({
        description:
          "Compact text or JSON describing the state to evaluate. Keep it focused on evidence relevant to the predicates.",
      }),
    }),
    async execute(_toolCallId, params) {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error("semantic_observe requires OPENROUTER_API_KEY");
      }

      const evaluate = createOpenRouterSemanticEvaluator({ apiKey });
      const result = await evaluate({
        state: params.state,
        predicates: DEFAULT_PREDICATES,
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        details: {
          advisory: true,
          predicates: Object.keys(DEFAULT_PREDICATES),
        },
      };
    },
  });
}
