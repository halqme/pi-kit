import assert from "node:assert/strict";
import test from "node:test";

import { modelSet, resolveControlPolicy } from "./control-policy.ts";

test("modelSet combines include and exact matches with exclude veto", () => {
  const models = modelSet().include("sol").is("gpt-6-luna").exclude("fable");

  assert.equal(models.matches("gpt-6.1-sol"), true);
  assert.equal(models.matches("chatgpt-5.6-sol-high"), true);
  assert.equal(models.matches("gpt-6-luna"), true);
  assert.equal(models.matches("gpt-6.1-sol-fable"), false);
  assert.equal(models.matches("claude-opus-4-1"), false);
});

test("modelSet matching is case-insensitive", () => {
  const models = modelSet().include("Sol").is("GPT-6-LUNA").exclude("FABLE");

  assert.equal(models.matches("GPT-6.1-SOL"), true);
  assert.equal(models.matches("gpt-6-luna"), true);
  assert.equal(models.matches("GPT-6.1-SOL-FABLE"), false);
});

test("capable model families use lean control", () => {
  for (const model of ["gpt-6-astra-wm", "gpt-6.1-sol", "openai-fable-2", "claude-opus-4-1"]) {
    assert.equal(resolveControlPolicy(model), "lean", model);
  }
});

test("lower-capability model families use robust control", () => {
  for (const model of [
    "gpt-5.6-luna",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
    "gemini-4-flash",
    "model-lite-preview",
    "openrouter/free",
  ]) {
    assert.equal(resolveControlPolicy(model), "robust", model);
  }
});

test("robust selectors win on conflicting model names", () => {
  assert.equal(resolveControlPolicy("experimental-sol-lite"), "robust");
  assert.equal(resolveControlPolicy("opus-free"), "robust");
});

test("unknown models stay robust", () => {
  assert.equal(resolveControlPolicy("claude-model-x"), "robust");
  assert.equal(resolveControlPolicy(undefined), "robust");
});

test("explicit control policy overrides embedded model routing", () => {
  assert.equal(resolveControlPolicy("gpt-6.1-sol", "robust"), "robust");
  assert.equal(resolveControlPolicy("gpt-5.6-luna", "lean"), "lean");
});

test("invalid override falls back to embedded model routing", () => {
  assert.equal(resolveControlPolicy("gpt-6.1-sol", "auto"), "lean");
  assert.equal(resolveControlPolicy("gpt-5.6-luna", "maximum"), "robust");
});
