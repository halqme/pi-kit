import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPiArgs,
  formatPiAgentFailure,
  normalizePiModel,
} from "./pi-runner.ts";

test("child argv uses explicit member model, bounded thinking, and safe tools", () => {
  const args = buildPiArgs(
    { name: "reviewer", role: "review", model: "member/model", skills: ["/tmp/review.SKILL.md"] },
    { model: "team/model", thinking: "medium", tools: ["read", "find"] },
  );

  assert.deepEqual(args, [
    "-p",
    "--no-session",
    "--model",
    "member/model",
    "--thinking",
    "medium",
    "--tools",
    "read,find",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--skill",
    "/tmp/review.SKILL.md",
  ]);
});

test("child argv does not inherit a model and cannot fall back to mutating tools", () => {
  const args = buildPiArgs({ name: "reviewer", role: "review" }, { tools: [] });

  assert.equal(args.includes("--model"), false);
  assert.deepEqual(args.slice(0, 6), [
    "-p",
    "--no-session",
    "--thinking",
    "low",
    "--no-tools",
    "--no-extensions",
  ]);
  assert.equal(args.includes("bash"), false);
  assert.equal(args.includes("edit"), false);
});

test("explicit models use provider/model syntax while whitespace stays omitted", () => {
  assert.equal(normalizePiModel("  "), undefined);
  assert.equal(normalizePiModel(" provider/model "), "provider/model");
  assert.throws(() => normalizePiModel("model-only"), /provider\/model/);
  assert.throws(() => normalizePiModel("provider/"), /provider\/model/);
  assert.throws(() => normalizePiModel("/model"), /provider\/model/);
});

test("async member failures retain the selected model recovery context", () => {
  const message = formatPiAgentFailure(
    "agent-team member 'reviewer' failed: provider rejected the request",
    "provider/model",
  );
  assert.match(message, /Selected model 'provider\/model'/);
  assert.match(message, /verify provider\/model/);
  assert.match(message, /omit it to use the child default/);
  assert.equal(formatPiAgentFailure("base failure"), "base failure");
});;
