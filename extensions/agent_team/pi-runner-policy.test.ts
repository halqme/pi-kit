import assert from "node:assert/strict";
import test from "node:test";
import { buildPiArgs } from "./pi-runner.ts";

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
