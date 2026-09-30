import assert from "node:assert/strict";
import test from "node:test";
import semanticObserverExtension from "./index.ts";

const usage = {
  input: 2,
  output: 3,
  cacheRead: 4,
  cacheWrite: 0,
  totalTokens: 9,
  cost: { input: 0.1, output: 0.2, cacheRead: 0.03, cacheWrite: 0, total: 0.33 },
};

function createHarness(modelAvailable = true, classifyResult?: (question: string) => unknown) {
  const calls: Array<{ model: unknown; context: any; options: any }> = [];
  let providerRegistrations = 0;
  let tool: any;
  semanticObserverExtension({
    registerProvider() {
      providerRegistrations++;
    },
    registerTool(candidate: unknown) {
      tool = candidate;
    },
  } as any);

  const ctx = {
    cwd: process.cwd(),
    sessionManager: {
      getEntries: () => [
        {
          type: "custom",
          customType: "task-state",
          data: {
            id: "task-1",
            goal: "keep the requested scope",
            acceptance: ["use current evidence"],
            status: "active",
            checkpoints: [],
          },
        },
      ],
    },
    modelRegistry: {
      findOfType(type: string, provider: string, id: string) {
        assert.equal(type, "classifier");
        assert.equal(provider, "typesafe");
        assert.equal(id, "jev-latest");
        return modelAvailable ? { provider, id } : undefined;
      },
      async classify(model: unknown, context: any, options: any) {
        calls.push({ model, context, options });
        const question = Object.keys(context.questions)[0] ?? "missing";
        if (classifyResult) return classifyResult(question);
        return {
          stopReason: "stop",
          model: "jev-latest",
          answers: { [question]: { type: "bool", probability: 0.25 } },
          usage,
        };
      },
    },
  };
  return {
    tool,
    ctx,
    calls,
    get providerRegistrations() {
      return providerRegistrations;
    },
  };
}

test("uses Pi's configured Jev classifier and reports its usage", async () => {
  const harness = createHarness();
  assert.equal(harness.tool.exposure, "deferred");
  const signal = new AbortController().signal;
  const result = await harness.tool.execute(
    "call",
    { observations: ["scopeDrift", "verificationGap"] },
    signal,
    undefined,
    harness.ctx,
  );
  const response = JSON.parse(result.content[0]?.text ?? "{}");

  assert.deepEqual(Object.keys(response.observations).sort(), ["scopeDrift", "verificationGap"]);
  assert.equal(response.observations.scopeDrift.probability, 0.25);
  assert.equal(response.observations.scopeDrift.model, "jev-latest");
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[0]?.options.signal, signal);
  assert.deepEqual(harness.calls.map((call) => Object.keys(call.context.questions)[0]).sort(), [
    "scope_drift",
    "verification_gap",
  ]);
  assert.equal(harness.calls[0]?.context.questions.scope_drift.type, "bool");
  assert.equal(result.usage?.input, 4);
  assert.equal(result.usage?.totalTokens, 18);
  assert.equal(result.usage?.cost.total, 0.66);
  assert.equal(harness.providerRegistrations, 0);
});

test("preserves classifier usage when observations partially fail", async () => {
  const failedUsage = {
    ...usage,
    input: 1,
    output: 1,
    cacheRead: 0,
    totalTokens: 2,
    cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
  };
  const harness = createHarness(true, (question) => {
    if (question === "scope_drift") {
      return {
        stopReason: "error",
        model: "jev-latest",
        answers: {},
        errorMessage: "classifier unavailable",
        usage: failedUsage,
      };
    }
    if (question === "verification_gap") throw new Error("network timeout");
    return {
      stopReason: "stop",
      model: "jev-latest",
      answers: { consistency_risk: { type: "bool", probability: 0.8 } },
      usage,
    };
  });
  const result = await harness.tool.execute(
    "call",
    { observations: ["scopeDrift", "verificationGap", "consistencyRisk"] },
    new AbortController().signal,
    undefined,
    harness.ctx,
  );
  const response = JSON.parse(result.content[0]?.text ?? "{}");

  assert.equal(result.isError, true);
  assert.deepEqual(Object.keys(response.observations), ["consistencyRisk"]);
  assert.deepEqual(
    response.errors.map((error: { observation: string }) => error.observation),
    ["scopeDrift", "verificationGap"],
  );
  assert.match(response.errors[0].error, /classifier unavailable/);
  assert.match(response.errors[1].error, /network timeout/);
  assert.equal(result.usage?.totalTokens, 11);
  assert.equal(result.usage?.cost.total, 0.36);
  assert.equal(harness.calls.length, 3);
});

test("reports when the built-in Jev classifier is not available", async () => {
  const harness = createHarness(false);
  await assert.rejects(
    () =>
      harness.tool.execute(
        "call",
        { observations: ["scopeDrift"] },
        new AbortController().signal,
        undefined,
        harness.ctx,
      ),
    /precondition: TypeSafe Jev classifier is unavailable/,
  );
  assert.equal(harness.calls.length, 0);
});
