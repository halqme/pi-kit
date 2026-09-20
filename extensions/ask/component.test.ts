import assert from "node:assert/strict";
import test from "node:test";
import { AskComponent } from "./component.ts";
import { createQuestionStates, generateQuestions, type AskResult, type Question } from "./model.ts";

function createComponent(question: Question): {
  component: AskComponent;
  result: () => AskResult | undefined;
} {
  const questions = generateQuestions([question]);
  const states = createQuestionStates(questions);
  let submitted: AskResult | undefined;

  const component = new AskComponent({
    questions,
    states,
    tui: { requestRender() {} } as any,
    theme: {
      fg(color: string, text: string) {
        return `<fg:${color}>${text}</fg:${color}>`;
      },
      bg(color: string, text: string) {
        return `<bg:${color}>${text}</bg:${color}>`;
      },
      bold(text: string) {
        return `<bold>${text}</bold>`;
      },
    } as any,
    done(result) {
      submitted = result;
    },
  });
  component.focused = true;

  return { component, result: () => submitted };
}

test("submits through the focused Confirm button", () => {
  const { component, result } = createComponent({ question: "Proceed?", type: "confirm" });
  const initial = component.render(80).join("\n");

  assert.match(initial, /\[ Confirm \]/);
  assert.doesNotMatch(initial, /Ctrl\+Enter/);

  component.handleInput("\r");
  component.handleInput("\t");

  const focused = component.render(80).join("\n");
  assert.match(focused, /<bg:selectedBg>/);

  component.handleInput("\r");
  assert.deepEqual(result(), { status: "submitted", answers: { q_1: true } });
});
