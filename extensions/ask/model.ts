export interface Option {
  label: string;
  value: string;
  description?: string;
}

interface BaseQuestion {
  question: string;
  required?: boolean;
}

export interface SingleQuestion extends BaseQuestion {
  type: "single";
  options: Option[];
  allowOther?: boolean;
}

export interface MultipleQuestion extends BaseQuestion {
  type: "multiple";
  options: Option[];
  minSelections?: number;
  maxSelections?: number;
  allowOther?: boolean;
}

export interface ConfirmQuestion {
  question: string;
  type: "confirm";
}

export type Question = SingleQuestion | MultipleQuestion | ConfirmQuestion;
export type GeneratedQuestion = Question & { id: string };

export type OtherAnswer = {
  type: "other";
  value: string;
};

export type Answer = string | boolean | OtherAnswer | Array<string | OtherAnswer>;

export type AskResult =
  | {
      status: "submitted";
      answers: Record<string, Answer>;
    }
  | {
      status: "cancelled";
    };

export type QuestionState =
  | {
      type: "single";
      value?: string;
      otherSelected: boolean;
      otherValue: string;
    }
  | {
      type: "multiple";
      values: Set<string>;
      otherSelected: boolean;
      otherValue: string;
    }
  | {
      type: "confirm";
      value?: boolean;
    };

export interface ValidationFailure {
  questionIndex: number;
  message: string;
}

function assertStateType<T extends QuestionState["type"]>(
  state: QuestionState,
  type: T,
  questionIndex: number,
): asserts state is Extract<QuestionState, { type: T }> {
  if (state.type !== type) {
    throw new Error(`question state mismatch at index ${questionIndex}`);
  }
}

export function generateQuestions(questions: Question[]): GeneratedQuestion[] {
  return questions.map((question, index) => ({ ...question, id: `q_${index + 1}` }));
}

export function createQuestionStates(questions: GeneratedQuestion[]): QuestionState[] {
  return questions.map((question) => {
    if (question.type === "single") {
      return { type: "single", otherSelected: false, otherValue: "" };
    }
    if (question.type === "multiple") {
      return { type: "multiple", values: new Set<string>(), otherSelected: false, otherValue: "" };
    }
    return { type: "confirm" };
  });
}

export function validateQuestionDefinitions(questions: GeneratedQuestion[]): void {
  for (const [questionIndex, question] of questions.entries()) {
    if (question.type === "confirm") continue;

    const seen = new Set<string>();
    for (const option of question.options) {
      if (seen.has(option.value)) {
        throw new Error(`question ${questionIndex + 1} has duplicate option value: ${option.value}`);
      }
      seen.add(option.value);
    }

    if (question.type === "multiple") {
      const required = question.required ?? true;
      const minSelections = Math.max(required ? 1 : 0, question.minSelections ?? (required ? 1 : 0));
      const maxSelections = question.maxSelections ?? question.options.length;
      if (minSelections > maxSelections) {
        throw new Error(`question ${questionIndex + 1} has minSelections greater than maxSelections`);
      }
      if (maxSelections > question.options.length) {
        throw new Error(`question ${questionIndex + 1} has maxSelections greater than options.length`);
      }
    }
  }
}

export function effectiveSelectionBounds(question: MultipleQuestion): { min: number; max: number } {
  const required = question.required ?? true;
  return {
    min: Math.max(required ? 1 : 0, question.minSelections ?? (required ? 1 : 0)),
    max: question.maxSelections ?? question.options.length,
  };
}

export function validateSubmission(
  questions: GeneratedQuestion[],
  states: QuestionState[],
): ValidationFailure | undefined {
  for (const [questionIndex, question] of questions.entries()) {
    const state = states[questionIndex];
    if (!state) throw new Error(`question state missing at index ${questionIndex}`);

    if (question.type === "confirm") {
      assertStateType(state, "confirm", questionIndex);
      if (state.value === undefined) {
        return { questionIndex, message: "Choose Yes or No." };
      }
      continue;
    }

    if (question.type === "single") {
      assertStateType(state, "single", questionIndex);
      const required = question.required ?? true;
      if (!state.value && !state.otherSelected) {
        if (required) return { questionIndex, message: "Choose an option." };
        continue;
      }
      if (state.otherSelected && state.otherValue.trim().length === 0) {
        return { questionIndex, message: "Enter a value for Other." };
      }
      continue;
    }

    assertStateType(state, "multiple", questionIndex);
    const { min, max } = effectiveSelectionBounds(question);
    const selectedCount = state.values.size + (state.otherSelected ? 1 : 0);
    if (selectedCount < min) {
      return { questionIndex, message: `Choose at least ${min} option${min === 1 ? "" : "s"}.` };
    }
    if (selectedCount > max) {
      return { questionIndex, message: `Choose at most ${max} option${max === 1 ? "" : "s"}.` };
    }
    if (state.otherSelected && state.otherValue.trim().length === 0) {
      return { questionIndex, message: "Enter a value for Other." };
    }
  }

  return undefined;
}

export function collectAnswers(
  questions: GeneratedQuestion[],
  states: QuestionState[],
): Record<string, Answer> {
  const answers: Record<string, Answer> = {};

  for (const [questionIndex, question] of questions.entries()) {
    const state = states[questionIndex];
    if (!state) throw new Error(`question state missing at index ${questionIndex}`);

    if (question.type === "confirm") {
      assertStateType(state, "confirm", questionIndex);
      if (state.value !== undefined) answers[question.id] = state.value;
      continue;
    }

    if (question.type === "single") {
      assertStateType(state, "single", questionIndex);
      if (state.otherSelected) {
        answers[question.id] = { type: "other", value: state.otherValue.trim() };
      } else if (state.value !== undefined) {
        answers[question.id] = state.value;
      }
      continue;
    }

    assertStateType(state, "multiple", questionIndex);
    const values: Array<string | OtherAnswer> = [...state.values];
    if (state.otherSelected) {
      values.push({ type: "other", value: state.otherValue.trim() });
    }
    if (values.length > 0) answers[question.id] = values;
  }

  return answers;
}
