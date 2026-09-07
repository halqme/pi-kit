import assert from "node:assert/strict";
import test from "node:test";
import extension from "./index.ts";
import {
  collectAnswers,
  createQuestionStates,
  generateQuestions,
  validateQuestionDefinitions,
  validateSubmission,
  type Question,
} from "./model.ts";

function registeredAsk(): any {
  let tool: any;
  extension({
    registerTool(value: any) {
      tool = value;
    },
  } as any);
  return tool;
}

test("generates stable call-local question ids", () => {
  const questions = generateQuestions([
    {
      question: "API?",
      type: "single",
      options: [
        { label: "Keep", value: "keep" },
        { label: "Break", value: "break" },
      ],
    },
    { question: "Proceed?", type: "confirm" },
  ]);

  assert.deepEqual(
    questions.map((question) => question.id),
    ["q_1", "q_2"],
  );
});

test("rejects duplicate option values and invalid multiple bounds", () => {
  assert.throws(
    () =>
      validateQuestionDefinitions(
        generateQuestions([
          {
            question: "Pick",
            type: "single",
            options: [
              { label: "A", value: "same" },
              { label: "B", value: "same" },
            ],
          },
        ]),
      ),
    /duplicate option value/,
  );

  assert.throws(
    () =>
      validateQuestionDefinitions(
        generateQuestions([
          {
            question: "Pick",
            type: "multiple",
            options: [
              { label: "A", value: "a" },
              { label: "B", value: "b" },
            ],
            maxSelections: 3,
          },
        ]),
      ),
    /maxSelections greater than options.length/,
  );
});

test("collects single, multiple, other, confirm, and omits unanswered optional questions", () => {
  const questions = generateQuestions([
    {
      question: "API?",
      type: "single",
      options: [
        { label: "Keep", value: "keep" },
        { label: "Break", value: "break" },
      ],
    },
    {
      question: "Targets?",
      type: "multiple",
      options: [
        { label: "Extension", value: "extension" },
        { label: "Docs", value: "docs" },
      ],
      allowOther: true,
    },
    { question: "Proceed?", type: "confirm" },
    {
      question: "Optional?",
      type: "single",
      required: false,
      options: [
        { label: "A", value: "a" },
        { label: "B", value: "b" },
      ],
    },
  ] satisfies Question[]);
  const states = createQuestionStates(questions);

  const first = states[0];
  const second = states[1];
  const third = states[2];
  assert.equal(first?.type, "single");
  assert.equal(second?.type, "multiple");
  assert.equal(third?.type, "confirm");
  if (!first || first.type !== "single" || !second || second.type !== "multiple" || !third || third.type !== "confirm") {
    throw new Error("unexpected state shape");
  }

  first.value = "keep";
  second.values.add("extension");
  second.otherSelected = true;
  second.otherValue = "社内向けAPI";
  third.value = true;

  assert.equal(validateSubmission(questions, states), undefined);
  assert.deepEqual(collectAnswers(questions, states), {
    q_1: "keep",
    q_2: ["extension", { type: "other", value: "社内向けAPI" }],
    q_3: true,
  });
});

test("requires non-empty Other text", () => {
  const questions = generateQuestions([
    {
      question: "API?",
      type: "single",
      allowOther: true,
      options: [
        { label: "Keep", value: "keep" },
        { label: "Break", value: "break" },
      ],
    },
  ]);
  const states = createQuestionStates(questions);
  const state = states[0];
  if (!state || state.type !== "single") throw new Error("unexpected state shape");
  state.otherSelected = true;

  assert.deepEqual(validateSubmission(questions, states), {
    questionIndex: 0,
    message: "Enter a value for Other.",
  });
});

test("returns cancellation as a normal tool result", async () => {
  const tool = registeredAsk();
  const result = await tool.execute(
    "call",
    {
      questions: [
        {
          question: "Proceed?",
          type: "confirm",
        },
      ],
    },
    undefined,
    undefined,
    {
      mode: "tui",
      ui: {
        async custom() {
          return { status: "cancelled" };
        },
      },
    },
  );

  assert.deepEqual(result.details, { status: "cancelled" });
});

test("rejects non-TUI use and concurrent ask calls", async () => {
  const tool = registeredAsk();
  const params = { questions: [{ question: "Proceed?", type: "confirm" }] };

  await assert.rejects(
    tool.execute("rpc", params, undefined, undefined, { mode: "rpc", ui: {} }),
    /interactive TUI/,
  );

  let release!: (value: unknown) => void;
  const pending = tool.execute("first", params, undefined, undefined, {
    mode: "tui",
    ui: {
      custom() {
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    },
  });

  await assert.rejects(
    tool.execute("second", params, undefined, undefined, {
      mode: "tui",
      ui: { custom: async () => ({ status: "cancelled" }) },
    }),
    /AskAlreadyActive/,
  );

  release({ status: "cancelled" });
  await pending;
});
