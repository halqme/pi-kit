import assert from "node:assert/strict";
import test from "node:test";
import { supervise, type ProtocolContext, type Supervisor } from "../src/index.ts";

type Context = ProtocolContext<{ type: string }, { ready: boolean }, string>;

const context: Context = {
  proposal: { type: "finish" },
  observation: { ready: false },
  trace: ["inspect", "implement"],
};

test("allows a proposal when no supervisor objects", async () => {
  const result = await supervise(context, []);
  assert.deepEqual(result.decision, { type: "allow" });
  assert.deepEqual(result.records, []);
});

test("stops at the first supervisor that blocks or injects", async () => {
  let reachedLaterSupervisor = false;
  const supervisors: Supervisor<Context>[] = [
    {
      name: "mechanical",
      evaluate(value) {
        assert.equal(value.trace.at(-1), "implement");
        return { type: "inject", context: "Verify the result before finishing." };
      },
    },
    {
      name: "later",
      evaluate() {
        reachedLaterSupervisor = true;
        return { type: "block", reason: "should not run" };
      },
    },
  ];

  const result = await supervise(context, supervisors);
  assert.equal(result.decision.type, "inject");
  assert.equal(reachedLaterSupervisor, false);
  assert.deepEqual(
    result.records.map((record) => record.supervisor),
    ["mechanical"],
  );
});

test("supports async supervisors such as model-backed reviewers", async () => {
  const supervisors: Supervisor<Context>[] = [
    {
      name: "reviewer",
      async evaluate(value) {
        await Promise.resolve();
        return value.observation.ready
          ? { type: "allow" }
          : { type: "block", reason: "Reviewer rejected completion." };
      },
    },
  ];

  const result = await supervise(context, supervisors);
  assert.deepEqual(result.decision, {
    type: "block",
    reason: "Reviewer rejected completion.",
  });
});
