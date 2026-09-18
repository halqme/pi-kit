export type SemanticPredicate = {
  description: string;
};

export type SemanticPredicateSet = Record<string, SemanticPredicate>;

export type SemanticDecision = {
  value: boolean;
  probability: number;
  confidence: number;
};

export type SemanticDecisionSet<T extends SemanticPredicateSet> = {
  [K in keyof T]: SemanticDecision;
};

export type EvaluateInput<T extends SemanticPredicateSet> = {
  state: unknown;
  predicates: T;
};

export type SemanticEvaluator = <T extends SemanticPredicateSet>(
  input: EvaluateInput<T>,
) => Promise<SemanticDecisionSet<T>>;

export type OpenRouterEvaluatorOptions = {
  apiKey: string;
  model?: string;
  endpoint?: string;
  fetch?: typeof globalThis.fetch;
};

type OpenRouterResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

const clampProbability = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid semantic decision ${field}`);
  }
  if (value < 0 || value > 1) {
    throw new Error(`Semantic decision ${field} must be between 0 and 1`);
  }
  return value;
};

export const parseSemanticDecisions = <T extends SemanticPredicateSet>(
  raw: unknown,
  predicates: T,
): SemanticDecisionSet<T> => {
  if (!raw || typeof raw !== "object") throw new Error("Invalid semantic decision response");
  const root = raw as { results?: unknown };
  if (!root.results || typeof root.results !== "object") {
    throw new Error("Semantic decision response is missing results");
  }

  const results = root.results as Record<string, unknown>;
  const parsed: Record<string, SemanticDecision> = {};

  for (const name of Object.keys(predicates)) {
    const candidate = results[name];
    if (!candidate || typeof candidate !== "object") {
      throw new Error(`Semantic decision response is missing predicate: ${name}`);
    }
    const decision = candidate as {
      value?: unknown;
      probability?: unknown;
      confidence?: unknown;
    };
    if (typeof decision.value !== "boolean") {
      throw new Error(`Invalid semantic decision value for ${name}`);
    }
    parsed[name] = {
      value: decision.value,
      probability: clampProbability(decision.probability, `${name}.probability`),
      confidence: clampProbability(decision.confidence, `${name}.confidence`),
    };
  }

  return parsed as SemanticDecisionSet<T>;
};

const buildResponseSchema = (predicates: SemanticPredicateSet) => ({
  type: "object",
  properties: {
    results: {
      type: "object",
      properties: Object.fromEntries(
        Object.keys(predicates).map((name) => [
          name,
          {
            type: "object",
            properties: {
              value: { type: "boolean" },
              probability: { type: "number", minimum: 0, maximum: 1 },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["value", "probability", "confidence"],
            additionalProperties: false,
          },
        ]),
      ),
      required: Object.keys(predicates),
      additionalProperties: false,
    },
  },
  required: ["results"],
  additionalProperties: false,
});

export const createOpenRouterSemanticEvaluator = (
  options: OpenRouterEvaluatorOptions,
): SemanticEvaluator => {
  const endpoint = options.endpoint ?? "https://openrouter.ai/api/v1/chat/completions";
  const model = options.model ?? "~typesafe/jev-latest";
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return async <T extends SemanticPredicateSet>({
    state,
    predicates,
  }: EvaluateInput<T>): Promise<SemanticDecisionSet<T>> => {
    if (Object.keys(predicates).length === 0) {
      return {} as SemanticDecisionSet<T>;
    }

    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              state,
              questions: Object.fromEntries(
                Object.entries(predicates).map(([name, predicate]) => [
                  name,
                  predicate.description,
                ]),
              ),
            }),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "semantic_predicates",
            strict: true,
            schema: buildResponseSchema(predicates),
          },
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter semantic evaluation failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as OpenRouterResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenRouter semantic evaluation returned no content");

    return parseSemanticDecisions(JSON.parse(content), predicates);
  };
};
