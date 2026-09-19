export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type NoulQuestion = {
  type: "noul";
  instructions: JsonValue;
  criteria?: {
    true: JsonValue;
    false: JsonValue;
  };
};

export type ChoiceQuestion = {
  type: "choice";
  instructions: JsonValue;
  criteria: Record<string, JsonValue>;
};

export type ScoreQuestion = {
  type: "score";
  instructions: JsonValue;
  criteria: JsonValue[];
};

export type SemanticQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type SemanticQuestionSet = Record<string, SemanticQuestion>;

export type NoulAnswer = {
  type: "noul";
  noul: number;
};

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type ScoreAnswer = {
  type: "score";
  score: number;
  legend: Record<string, JsonValue>;
  probabilities: Record<string, number>;
  confidence: number;
};

export type SemanticAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type AnswerForQuestion<T extends SemanticQuestion> = T extends NoulQuestion
  ? NoulAnswer
  : T extends ChoiceQuestion
    ? ChoiceAnswer
    : T extends ScoreQuestion
      ? ScoreAnswer
      : never;

export type AnswersForQuestions<T extends SemanticQuestionSet> = {
  [K in keyof T]: AnswerForQuestion<T[K]>;
};

export type EvaluateInput<T extends SemanticQuestionSet> = {
  state: JsonValue;
  questions: T;
};

export type SemanticDecisionResponse<T extends SemanticQuestionSet> = {
  model?: string;
  answers: AnswersForQuestions<T>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    [key: string]: JsonValue | undefined;
  };
  [key: string]: unknown;
};

export type SemanticEvaluator = <T extends SemanticQuestionSet>(
  input: EvaluateInput<T>,
) => Promise<SemanticDecisionResponse<T>>;

export type OpenRouterEvaluatorOptions = {
  apiKey: string;
  model?: string;
  endpoint?: string;
  fetch?: typeof globalThis.fetch;
  headers?: Record<string, string>;
};

const probability = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid probability: ${field}`);
  }
  if (value < 0 || value > 1) {
    throw new Error(`${field} must be between 0 and 1`);
  }
  return value;
};

const probabilities = (value: unknown, field: string): Record<string, number> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid probability distribution: ${field}`);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, candidate]) => [
      key,
      probability(candidate, `${field}.${key}`),
    ]),
  );
};

const parseAnswer = (raw: unknown, question: SemanticQuestion, id: string): SemanticAnswer => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Missing answer for question: ${id}`);
  }

  const answer = raw as Record<string, unknown>;
  if (answer.type !== question.type) {
    throw new Error(`Unexpected answer type for question: ${id}`);
  }

  if (question.type === "noul") {
    return {
      type: "noul",
      noul: probability(answer.noul, `${id}.noul`),
    };
  }

  if (question.type === "choice") {
    if (typeof answer.choice !== "string" || !(answer.choice in question.criteria)) {
      throw new Error(`Invalid choice for question: ${id}`);
    }

    return {
      type: "choice",
      choice: answer.choice,
      probabilities: probabilities(answer.probabilities, `${id}.probabilities`),
      confidence: probability(answer.confidence, `${id}.confidence`),
    };
  }

  if (typeof answer.score !== "number" || !Number.isFinite(answer.score)) {
    throw new Error(`Invalid score for question: ${id}`);
  }
  if (!answer.legend || typeof answer.legend !== "object" || Array.isArray(answer.legend)) {
    throw new Error(`Invalid score legend for question: ${id}`);
  }

  return {
    type: "score",
    score: answer.score,
    legend: answer.legend as Record<string, JsonValue>,
    probabilities: probabilities(answer.probabilities, `${id}.probabilities`),
    confidence: probability(answer.confidence, `${id}.confidence`),
  };
};

export const parseSemanticDecisionResponse = <T extends SemanticQuestionSet>(
  raw: unknown,
  questions: T,
): SemanticDecisionResponse<T> => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Invalid semantic decision response");
  }

  const response = raw as Record<string, unknown>;
  if (
    !response.answers ||
    typeof response.answers !== "object" ||
    Array.isArray(response.answers)
  ) {
    throw new Error("Semantic decision response is missing answers");
  }

  const rawAnswers = response.answers as Record<string, unknown>;
  const parsedAnswers: Record<string, SemanticAnswer> = {};

  for (const [id, question] of Object.entries(questions)) {
    parsedAnswers[id] = parseAnswer(rawAnswers[id], question, id);
  }

  const parsed: SemanticDecisionResponse<T> = {
    answers: parsedAnswers as AnswersForQuestions<T>,
  };

  if (typeof response.model === "string") {
    parsed.model = response.model;
  }
  if (response.usage && typeof response.usage === "object") {
    parsed.usage = response.usage as NonNullable<SemanticDecisionResponse<T>["usage"]>;
  }

  return parsed;
};

export const createOpenRouterSemanticEvaluator = (
  options: OpenRouterEvaluatorOptions,
): SemanticEvaluator => {
  const endpoint = options.endpoint ?? "https://openrouter.ai/api/alpha/decisions";
  const model = options.model ?? "typesafe/jev-1.13";
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return async <T extends SemanticQuestionSet>({
    state,
    questions,
  }: EvaluateInput<T>): Promise<SemanticDecisionResponse<T>> => {
    if (Object.keys(questions).length === 0) {
      return { model, answers: {} as AnswersForQuestions<T> };
    }

    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
      body: JSON.stringify({
        model,
        state,
        questions,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenRouter semantic evaluation failed (${response.status}): ${body}`);
    }

    return parseSemanticDecisionResponse(await response.json(), questions);
  };
};
