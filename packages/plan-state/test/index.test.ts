import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyPlan,
  recordProgress,
  remainingSteps,
  restorePlanState,
  transitionRunner,
  validatePlanState,
} from "../src/index.ts";

test("validates and records idempotent progress", () => {
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
  assert.equal(state.status, "completed");
});

test("runner transitions approved plans through running to completed", () => {
  const approved = emptyPlan("planner");
  approved.status = "approved";
  approved.steps = [
    { step: 1, text: "Inspect", completed: false },
    { step: 2, text: "Test", completed: false },
  ];

  const running = transitionRunner(approved, { type: "start" });
  assert.equal(running.status, "running");
  assert.equal(running.stage, "runner");
  assert.equal(approved.status, "approved");

  const partial = transitionRunner(running, { type: "progress", steps: [1] });
  assert.equal(partial.status, "running");
  assert.deepEqual(
    remainingSteps(partial).map((step) => step.step),
    [2],
  );

  const completed = transitionRunner(partial, { type: "progress", steps: [2] });
  assert.equal(completed.status, "completed");
  assert.throws(() => transitionRunner(completed, { type: "progress", steps: [2] }), /completed/);
});

test("runner rejects invalid transitions and records terminal stop reasons", () => {
  const planned = emptyPlan("planner");
  planned.status = "planned";
  planned.steps = [{ step: 1, text: "Inspect", completed: false }];
  assert.throws(() => transitionRunner(planned, { type: "start" }), /planned/);

  const approved = { ...planned, status: "approved" as const };
  const running = transitionRunner(approved, { type: "start" });
  const stopped = transitionRunner(running, { type: "stop", reason: "Blocked" });
  assert.equal(stopped.status, "stopped");
  assert.equal(stopped.stopReason, "Blocked");
  assert.throws(() => transitionRunner(stopped, { type: "progress", steps: [1] }), /stopped/);

  const rerun = transitionRunner(approved, { type: "start" });
  const exhausted = transitionRunner(rerun, { type: "exhaust", reason: "Fuse reached" });
  assert.equal(exhausted.status, "stopped");
  assert.equal(exhausted.stopReason, "Fuse reached");
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
