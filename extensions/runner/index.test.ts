import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { emptyPlan, savePlanState } from "@halqme/plan-state";
import runnerExtension from "./index.ts";
import { loopController } from "../loop/control.ts";

test("runner owns loop continuation for an approved plan", async () => {
  let tool: any;
  const entries: any[] = [];
  const pi = {
    registerTool(value: any) {
      tool = value;
    },
    appendEntry(type: string, data: unknown) {
      entries.push({ type: "custom", customType: type, data });
    },
  } as unknown as ExtensionAPI;

  loopController.configure(() => {});
  loopController.restore(undefined);
  runnerExtension(pi);

  const approved = emptyPlan("planner");
  approved.status = "approved";
  approved.steps = [
    { step: 1, text: "change code", completed: false },
    { step: 2, text: "run checks", completed: false },
  ];
  savePlanState(pi, approved);
  const ctx = { sessionManager: { getEntries: () => entries } } as any;

  const started = await tool.execute(
    "1",
    { action: "start", maxTurns: 5 },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(started.details.status, "running");
  assert.equal(loopController.snapshot()?.owner, "runner");
  assert.equal(loopController.snapshot()?.status, "active");

  const partial = await tool.execute(
    "2",
    { action: "progress", summary: "editing step one" },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(partial.details.status, "running");
  const followUp = loopController.onAgentEnd();
  assert.match(followUp.followUp ?? "", /runner\.progress/);
  assert.match(followUp.followUp ?? "", /editing step one/);

  await tool.execute(
    "3",
    { action: "progress", steps: [1], summary: "code changed" },
    undefined,
    undefined,
    ctx,
  );
  const remainingFollowUp = loopController.onAgentEnd();
  assert.doesNotMatch(remainingFollowUp.followUp ?? "", /1\. change code/);
  assert.match(remainingFollowUp.followUp ?? "", /2\. run checks/);

  const completed = await tool.execute(
    "4",
    { action: "progress", steps: [2], summary: "checks passed" },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(completed.details.status, "completed");
  assert.equal(loopController.snapshot()?.status, "done");
  assert.equal(loopController.onAgentEnd().followUp, undefined);
});

test("runner rejects direct competition with another active loop", async () => {
  let tool: any;
  const entries: any[] = [];
  const pi: any = {
    registerTool(value: any) {
      tool = value;
    },
    appendEntry(type: string, data: unknown) {
      entries.push({ type: "custom", customType: type, data });
    },
  };
  loopController.configure(() => {});
  loopController.restore(undefined);
  loopController.start("loop", "other work", 3);
  runnerExtension(pi);
  const approved = emptyPlan("planner");
  approved.status = "approved";
  approved.steps = [{ step: 1, text: "change code", completed: false }];
  savePlanState(pi, approved);
  const ctx = { sessionManager: { getEntries: () => entries } };
  const result = await tool.execute("1", { action: "start" }, undefined, undefined, ctx);
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /loop is active/);
});
