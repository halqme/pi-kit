import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyPlan,
  recordProgress,
  remainingSteps,
  restorePlanState,
  validatePlanState,
} from "../src/index.ts";

test("records idempotent progress without deciding protocol completion", () => {
  const state = validatePlanState({
    ...emptyPlan("runner"),
    status: "running",
    steps: [
      { step: 1, text: "Inspect", completed: false },
      { step: 2, text: "Test", completed: false },
    ],
  });
  assert.equal(recordProgress(state, [1, 1]), 1);
  assert.deepEqual(
    remainingSteps(state).map((step) => step.step),
    [2],
  );
  assert.equal(recordProgress(state, [2]), 1);
  assert.equal(remainingSteps(state).length, 0);
  assert.equal(state.status, "running");
});

test("restores only the latest session entry", () => {
  const state = emptyPlan("grill", "Task");
  assert.deepEqual(
    restorePlanState([{ type: "custom", customType: "plan-state", data: state }]),
    state,
  );
  assert.equal(restorePlanState([]), undefined);
  assert.throws(() => validatePlanState({ ...state, version: 2 }), /version/);
});
