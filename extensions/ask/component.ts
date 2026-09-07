import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
  Input,
  type Component,
  type Focusable,
  type TUI,
  matchesKey,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import {
  collectAnswers,
  effectiveSelectionBounds,
  type AskResult,
  type GeneratedQuestion,
  type QuestionState,
  validateSubmission,
} from "./model.ts";

type Theme = ExtensionUIContext["theme"];

type Done = (result: AskResult) => void;

export class AskComponent implements Component, Focusable {
  private readonly questions: GeneratedQuestion[];
  private readonly states: QuestionState[];
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly done: Done;
  private readonly optionCursors: number[];
  private readonly otherInputs = new Map<number, Input>();
  private readonly abortSignal: AbortSignal | undefined;
  private readonly abortHandler: (() => void) | undefined;

  private currentQuestion = 0;
  private editingOther = false;
  private error: string | undefined;
  private _focused = false;

  constructor(options: {
    questions: GeneratedQuestion[];
    states: QuestionState[];
    tui: TUI;
    theme: Theme;
    done: Done;
    signal?: AbortSignal;
  }) {
    this.questions = options.questions;
    this.states = options.states;
    this.tui = options.tui;
    this.theme = options.theme;
    this.done = options.done;
    this.optionCursors = options.questions.map(() => 0);
    this.abortSignal = options.signal;

    for (const [index, question] of options.questions.entries()) {
      if (question.type !== "confirm" && question.allowOther) {
        this.otherInputs.set(index, new Input());
      }
    }

    if (this.abortSignal) {
      this.abortHandler = () => this.done({ status: "cancelled" });
      this.abortSignal.addEventListener("abort", this.abortHandler, { once: true });
    }
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.syncInputFocus();
  }

  dispose(): void {
    if (this.abortSignal && this.abortHandler) {
      this.abortSignal.removeEventListener("abort", this.abortHandler);
    }
  }

  invalidate(): void {
    for (const input of this.otherInputs.values()) input.invalidate();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.done({ status: "cancelled" });
      return;
    }

    if (matchesKey(data, "ctrl+enter")) {
      this.submit();
      return;
    }

    if (matchesKey(data, "tab")) {
      this.moveQuestion(1);
      return;
    }

    if (matchesKey(data, "shift+tab")) {
      this.moveQuestion(-1);
      return;
    }

    if (this.editingOther) {
      if (matchesKey(data, "enter")) {
        this.editingOther = false;
        this.syncInputFocus();
        this.requestRender();
        return;
      }
      if (matchesKey(data, "up") || matchesKey(data, "down")) {
        this.editingOther = false;
        this.syncInputFocus();
        this.moveOption(matchesKey(data, "up") ? -1 : 1);
        return;
      }
      const input = this.otherInputs.get(this.currentQuestion);
      input?.handleInput(data);
      this.syncOtherValue();
      this.error = undefined;
      this.requestRender();
      return;
    }

    if (matchesKey(data, "up")) {
      this.moveOption(-1);
      return;
    }
    if (matchesKey(data, "down")) {
      this.moveOption(1);
      return;
    }

    const question = this.questions[this.currentQuestion];
    const state = this.states[this.currentQuestion];
    if (!question || !state || state.type !== question.type) return;

    if (question.type === "multiple" && state.type === "multiple" && matchesKey(data, "space")) {
      this.toggleMultiple(question, state);
      return;
    }

    if (question.type === "single" && state.type === "single" && matchesKey(data, "enter")) {
      this.selectSingleOrConfirm(question, state);
      return;
    }

    if (question.type === "confirm" && state.type === "confirm" && matchesKey(data, "enter")) {
      this.selectSingleOrConfirm(question, state);
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(20, width);
    const lines: string[] = [];
    lines.push(this.theme.fg("accent", this.theme.bold("Questions")));
    lines.push("");

    for (const [questionIndex, question] of this.questions.entries()) {
      const active = questionIndex === this.currentQuestion;
      const required = question.type === "confirm" || (question.required ?? true);
      const suffix = required ? "" : this.theme.fg("dim", " (optional)");
      const prefix = active ? this.theme.fg("accent", "❯") : " ";
      lines.push(
        truncateToWidth(
          `${prefix} ${questionIndex + 1}. ${this.theme.bold(question.question)}${suffix}`,
          safeWidth,
        ),
      );

      const optionCount = this.optionCount(questionIndex);
      for (let optionIndex = 0; optionIndex < optionCount; optionIndex++) {
        lines.push(...this.renderOption(questionIndex, optionIndex, safeWidth));
      }

      if (this.isOtherSelected(questionIndex)) {
        const input = this.otherInputs.get(questionIndex);
        if (input) {
          for (const line of input.render(Math.max(1, safeWidth - 6))) {
            lines.push(`      ${line}`);
          }
        }
      }

      if (active && this.error) {
        lines.push(`    ${this.theme.fg("error", this.error)}`);
      }
      lines.push("");
    }

    lines.push(
      this.theme.fg(
        "dim",
        "↑/↓ move  Space toggle  Enter select  Tab/Shift+Tab question  Ctrl+Enter submit  Esc cancel",
      ),
    );
    return lines;
  }

  private renderOption(questionIndex: number, optionIndex: number, width: number): string[] {
    const question = this.questions[questionIndex];
    const state = this.states[questionIndex];
    if (!question || !state || state.type !== question.type) return [];

    const active = questionIndex === this.currentQuestion && optionIndex === this.optionCursors[questionIndex];
    const cursor = active && !this.editingOther ? this.theme.fg("accent", "❯") : " ";

    let label: string;
    let description: string | undefined;
    let marker: string;

    if (question.type === "confirm") {
      if (state.type !== "confirm") return [];
      const value = optionIndex === 0;
      label = value ? "Yes" : "No";
      marker = state.value === value ? "◉" : "○";
    } else if (optionIndex < question.options.length) {
      const option = question.options[optionIndex];
      if (!option) return [];
      label = option.label;
      description = option.description;
      if (question.type === "single") {
        if (state.type !== "single") return [];
        marker = !state.otherSelected && state.value === option.value ? "◉" : "○";
      } else {
        if (state.type !== "multiple") return [];
        marker = state.values.has(option.value) ? "☑" : "☐";
      }
    } else {
      label = "Other...";
      if (question.type === "single") {
        if (state.type !== "single") return [];
        marker = state.otherSelected ? "◉" : "○";
      } else {
        if (state.type !== "multiple") return [];
        marker = state.otherSelected ? "☑" : "☐";
      }
    }

    const lines = [truncateToWidth(`    ${cursor} ${marker} ${label}`, width)];
    if (description) {
      lines.push(truncateToWidth(`        ${this.theme.fg("dim", description)}`, width));
    }
    return lines;
  }

  private moveQuestion(delta: number): void {
    const count = this.questions.length;
    this.currentQuestion = (this.currentQuestion + delta + count) % count;
    this.editingOther = false;
    this.error = undefined;
    this.syncInputFocus();
    this.requestRender();
  }

  private moveOption(delta: number): void {
    const count = this.optionCount(this.currentQuestion);
    if (count === 0) return;
    const current = this.optionCursors[this.currentQuestion] ?? 0;
    this.optionCursors[this.currentQuestion] = Math.min(count - 1, Math.max(0, current + delta));
    this.error = undefined;
    this.requestRender();
  }

  private optionCount(questionIndex: number): number {
    const question = this.questions[questionIndex];
    if (!question) return 0;
    if (question.type === "confirm") return 2;
    return question.options.length + (question.allowOther ? 1 : 0);
  }

  private selectSingleOrConfirm(question: GeneratedQuestion, state: QuestionState): void {
    const cursor = this.optionCursors[this.currentQuestion] ?? 0;
    this.error = undefined;

    if (question.type === "confirm" && state.type === "confirm") {
      state.value = cursor === 0;
      this.requestRender();
      return;
    }

    if (question.type !== "single" || state.type !== "single") return;
    if (cursor < question.options.length) {
      const option = question.options[cursor];
      if (!option) return;
      state.value = option.value;
      state.otherSelected = false;
      this.editingOther = false;
      this.syncInputFocus();
      this.requestRender();
      return;
    }

    if (question.allowOther) {
      delete state.value;
      state.otherSelected = true;
      this.editingOther = true;
      this.syncInputFocus();
      this.requestRender();
    }
  }

  private toggleMultiple(
    question: Extract<GeneratedQuestion, { type: "multiple" }>,
    state: Extract<QuestionState, { type: "multiple" }>,
  ): void {
    const cursor = this.optionCursors[this.currentQuestion] ?? 0;
    const { max } = effectiveSelectionBounds(question);
    this.error = undefined;

    if (cursor < question.options.length) {
      const option = question.options[cursor];
      if (!option) return;
      if (state.values.has(option.value)) {
        state.values.delete(option.value);
      } else {
        const count = state.values.size + (state.otherSelected ? 1 : 0);
        if (count >= max) {
          this.error = `Choose at most ${max} option${max === 1 ? "" : "s"}.`;
          this.requestRender();
          return;
        }
        state.values.add(option.value);
      }
      this.requestRender();
      return;
    }

    if (!question.allowOther) return;
    if (state.otherSelected) {
      state.otherSelected = false;
      this.editingOther = false;
    } else {
      if (state.values.size >= max) {
        this.error = `Choose at most ${max} option${max === 1 ? "" : "s"}.`;
        this.requestRender();
        return;
      }
      state.otherSelected = true;
      this.editingOther = true;
    }
    this.syncInputFocus();
    this.requestRender();
  }

  private isOtherSelected(questionIndex: number): boolean {
    const state = this.states[questionIndex];
    return state?.type === "single" || state?.type === "multiple" ? state.otherSelected : false;
  }

  private syncOtherValue(): void {
    const state = this.states[this.currentQuestion];
    const input = this.otherInputs.get(this.currentQuestion);
    if (!state || !input || (state.type !== "single" && state.type !== "multiple")) return;
    state.otherValue = input.getValue();
  }

  private syncInputFocus(): void {
    for (const input of this.otherInputs.values()) input.focused = false;
    if (!this._focused || !this.editingOther) return;
    const input = this.otherInputs.get(this.currentQuestion);
    if (input) input.focused = true;
  }

  private submit(): void {
    this.syncOtherValue();
    const failure = validateSubmission(this.questions, this.states);
    if (failure) {
      this.currentQuestion = failure.questionIndex;
      this.editingOther = this.isOtherSelected(failure.questionIndex) && failure.message.includes("Other");
      this.error = failure.message;
      this.syncInputFocus();
      this.requestRender();
      return;
    }

    this.done({ status: "submitted", answers: collectAnswers(this.questions, this.states) });
  }

  private requestRender(): void {
    this.tui.requestRender();
  }
}
