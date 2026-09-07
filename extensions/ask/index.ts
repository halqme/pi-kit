import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { AskComponent } from "./component.ts";
import {
  createQuestionStates,
  generateQuestions,
  type AskResult,
  type Question,
  validateQuestionDefinitions,
} from "./model.ts";

const OptionSchema = Type.Object(
  {
    label: Type.String({ minLength: 1, description: "Short label shown to the user" }),
    value: Type.String({ minLength: 1, description: "Stable machine-readable value returned to the model" }),
    description: Type.Optional(Type.String({ minLength: 1, description: "Optional short explanation" })),
  },
  { additionalProperties: false },
);

const SingleQuestionSchema = Type.Object(
  {
    question: Type.String({ minLength: 1, description: "Self-contained question shown to the user" }),
    type: Type.Literal("single"),
    options: Type.Array(OptionSchema, { minItems: 2, maxItems: 10 }),
    required: Type.Optional(Type.Boolean({ default: true })),
    allowOther: Type.Optional(Type.Boolean({ default: false })),
  },
  { additionalProperties: false },
);

const MultipleQuestionSchema = Type.Object(
  {
    question: Type.String({ minLength: 1, description: "Self-contained question shown to the user" }),
    type: Type.Literal("multiple"),
    options: Type.Array(OptionSchema, { minItems: 2, maxItems: 10 }),
    required: Type.Optional(Type.Boolean({ default: true })),
    minSelections: Type.Optional(Type.Integer({ minimum: 0 })),
    maxSelections: Type.Optional(Type.Integer({ minimum: 0 })),
    allowOther: Type.Optional(Type.Boolean({ default: false })),
  },
  { additionalProperties: false },
);

const ConfirmQuestionSchema = Type.Object(
  {
    question: Type.String({ minLength: 1, description: "Confirmation question shown to the user" }),
    type: Type.Literal("confirm"),
  },
  { additionalProperties: false },
);

const QuestionSchema = Type.Union([SingleQuestionSchema, MultipleQuestionSchema, ConfirmQuestionSchema]);

export default function askExtension(pi: ExtensionAPI): void {
  let askActive = false;

  pi.registerTool({
    name: "ask",
    label: "Ask",
    description:
      "Ask the user one or more structured choice questions when their decision is required. Supports single choice, multiple choice, Other free text, and confirm questions. Use only for genuine user decisions; do not use for choices the user already answered, routine implementation details the model can decide, progress updates, or next-action suggestions.",
    promptGuidelines: [
      "Use ask only when a user decision is necessary and finite explicit choices are appropriate.",
      "Batch independent decisions into one ask call when that reduces back-and-forth.",
      "Do not ask again for information or authorization the user already supplied.",
      "Do not use ask for trivial implementation details, progress reports, or next-action suggestions.",
      "Do not preselect or recommend an option through ordering or wording; present neutral choices.",
    ],
    parameters: Type.Object(
      {
        questions: Type.Array(QuestionSchema, {
          minItems: 1,
          maxItems: 10,
          description: "One to ten structured questions shown together",
        }),
      },
      { additionalProperties: false },
    ),
    renderCall(args, theme) {
      const count = args.questions.length;
      return new Text(
        `${theme.fg("toolTitle", theme.bold("ask"))} ${theme.fg("dim", `${count} question${count === 1 ? "" : "s"}`)}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme, context) {
      const details = result.details as AskResult | undefined;
      const summary = context.isError
        ? result.content.find((item) => item.type === "text")?.text || "ask failed"
        : details?.status === "cancelled"
          ? "cancelled"
          : details?.status === "submitted"
            ? `${Object.keys(details.answers).length} answer${Object.keys(details.answers).length === 1 ? "" : "s"}`
            : "done";
      return new Text(theme.fg(context.isError ? "error" : "toolOutput", summary), 0, 0);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (ctx.mode !== "tui") {
        throw new Error("ask requires Pi interactive TUI mode");
      }
      if (askActive) {
        throw new Error("AskAlreadyActive");
      }

      const questions = generateQuestions(params.questions as Question[]);
      validateQuestionDefinitions(questions);
      const states = createQuestionStates(questions);

      askActive = true;
      try {
        const result = await ctx.ui.custom<AskResult>((tui, theme, _keybindings, done) =>
          new AskComponent({
            questions,
            states,
            tui,
            theme,
            done,
            ...(signal ? { signal } : {}),
          }),
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } finally {
        askActive = false;
      }
    },
  });
}
