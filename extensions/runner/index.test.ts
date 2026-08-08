import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { emptyPlan, savePlanState } from "@halqme/plan-state";
import { loopController } from "../loop/control.ts";
import runnerExtension from "./index.ts";

function harness() {
  let tool: any;
  const entries: any[] = [];
  const pi = {
    registerTool(value: any) {
      tool = value;
    },
    on() {},
    appendEntry(type: string, data: unknown) {
      entries.push({ type: "custom", customType: type, data });
    },
  } as unknown as ExtensionAPI;

  loopController.configure(() => {});
  loopController.restore(undefined);
  runnerExtension(pi);

  return {
    get tool() {
      return tool;
    },
    pi,
    entries,
    ctx: { sessionManager: { getEntries: () => entries } } as any,
  };
}

test("runner treats TODO progress as evidence and requires an explicit finish proposal", async () => {
  const h = harness();
  const approved = emptyPlan("planner");
  approved.status = "approved";
  approved.steps = [
    { step: 1, text: "change code", completed: false },
    { step: 2, text: "run checks", completed: false },
  ];
  savePlanState(h.pi, approved);

  const started = await h.tool.execute(
    "1",
    { action: "start", maxTurns: 5 },
    undefined,
    undefined,
    h.ctx,
  );
  assert.equal(started.details.status, "running");
  assert.equal(loopController.snapshot()?.owner, "runner");
  assert.equal(loopController.snapshot()?.status, "active");

  const partial = await h.tool.execute(
    "2",
    { action: "progress", summary: "editing step one" },
    undefined,
    undefined,
    h.ctx,
  );
  assert.equal(partial.details.status, "running");
  const followUp = loopController.onAgentEnd();
  assert.match(followUp.followUp ?? "", /runner\.progress/);
  assert.match(followUp.followUp ?? "", /editing step one/);

  await h.tool.execute(
    "3",
    { action: "progress", steps: [1], summary: "code changed" },
    undefined,
    undefined,
    h.ctx,
  );
  const remainingFollowUp = loopController.onAgentEnd();
  assert.doesNotMatch(remainingFollowUp.followUp ?? "", /1\. change code/);
  assert.match(remainingFollowUp.followUp ?? "", /2\. run checks/);

  const reported = await h.tool.execute(
    "4",
    { action: "progress", steps: [2], summary: "checks passed" },
    undefined,
    undefined,
    h.ctx,
  );
  assert.equal(reported.details.status, "running");
  assert.equal(loopController.snapshot()?.status, "active");
  assert.match(reported.content[0].text, /runner\.finish/);
  const verificationFollowUp = loopController.onAgentEnd();
  assert.match(verificationFollowUp.followUp ?? "", /runner\.finish/);
  assert.match(verificationFollowUp.followUp ?? "", /complete-task/);

  const completed = await h.tool.execute(
    "5",
    { action: "finish", evidence: "Requested change is present and checks pass." },
    undefined,
    undefined,
    h.ctx,
  );
  assert.equal(completed.details.status, "completed");
  assert.equal(loopController.snapshot()?.status, "done");
  assert.equal(loopController.onAgentEnd().followUp, undefined);
});

test("runner supervision injects completion requirements instead of forcing a transition", async () => {
  const h = harness();
  const approved = emptyPlan("planner");
  approved.status = "approved";
  approved.steps = [{ step: 1, text: "change code", completed: false }];
  savePlanState(h.pi, approved);

  await h.tool.execute("1", { action: "start" }, undefined, undefined, h.ctx);

  const earlyFinish = await h.tool.execute(
    "2",
    { action: "finish", evidence: "Looks good." },
    undefined,
    undefined,
    h.ctx,
  );
  assert.equal(earlyFinish.details.status, "running");
  assert.equal(earlyFinish.isError, undefined);
  assert.match(earlyFinish.content[0].text, /remaining TODO steps/);

  await h.tool.execute(
    "3",
    { action: "progress", steps: [1], summary: "code changed" },
    undefined,
    undefined,
    h.ctx,
  );
  const noEvidence = await h.tool.execute(
    "4",
    { action: "finish" },
    undefined,
    undefined,
    h.ctx,
  );
  assert.equal(noEvidence.details.status, "running");
  assert.equal(noEvidence.isError, undefined);
  assert.match(noEvidence.content[0].text, /empty checklist is not a completion verdict/);
});

test("runner blocks direct competition with another active loop", async () => {
  const h = harness();
  loopController.start("loop", "other work", 3);
  const approved = emptyPlan("planner");
  approved.status = "approved";
  approved.steps = [{ step: 1, text: "change code", completed: false }];
  savePlanState(h.pi, approved);

  const result = await h.tool.execute("1", { action: "start" }, undefined, undefined, h.ctx);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /loop is active/);
});

test("runner records loop exhaustion as a hard runtime stop", async () => {
  const h = harness();
  const approved = emptyPlan("planner");
  approved.status = "approved";
  approved.steps = [{ step: 1, text: "change code", completed: false }];
  savePlanState(h.pi, approved);

  await h.tool.execute("1", { action: "start", maxTurns: 1 }, undefined, undefined, h.ctx);
  const result = loopController.onAgentEnd();
  assert.equal(result.exhausted, true);
  assert.equal(loopController.snapshot()?.status, "exhausted");

  const status = await h.tool.execute("2", { action: "status" }, undefined, undefined, h.ctx);
  assert.equal(status.details.status, "stopped");
  assert.match(status.details.stopReason, /Maximum turn count reached/);
});
