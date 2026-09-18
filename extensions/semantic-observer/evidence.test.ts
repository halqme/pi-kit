import assert from "node:assert/strict";
import test from "node:test";

import type { TaskEvidencePacket } from "../task/evidence.ts";
import { projectObservationState } from "./evidence.ts";

const packet: TaskEvidencePacket = {
  task: {
    id: "task-1",
    goal: "Update the parser only",
    acceptance: ["Parser accepts the new syntax"],
    status: "active",
    latestCheckpoint: {
      at: "2026-09-18T00:00:00.000Z",
      summary: "Parser implementation is in progress",
      plan: ["Rewrite unrelated renderer", "Update parser"],
      completed: ["Located parser"],
    },
  },
  resources: {
    observed: ["src/parser.ts", "src/parser.test.ts"],
    mutated: ["src/parser.ts"],
    changedDuringTask: ["src/parser.ts"],
    preexistingDirty: [],
    timeline: [
      {
        operation: "observe",
        path: "src/parser.ts",
        tool: "context",
        action: "inspect",
        toolCallId: "context-1",
      },
      {
        operation: "mutate",
        path: "src/parser.ts",
        tool: "code",
        action: "edit",
        toolCallId: "code-1",
      },
    ],
    coverage: {
      observations: "explicit-tools",
      mutations: "explicit-tools",
      workspaceDelta: "git",
      opaqueToolEffects: "not-attributed",
    },
  },
  verification: [
    {
      id: "verify-1",
      taskId: "task-1",
      provenance: "typecheck",
      origin: "executed",
      passed: true,
      summary: "tsc --noEmit",
      at: "2026-09-18T00:01:00.000Z",
    },
    {
      id: "verify-2",
      taskId: "task-1",
      provenance: "self_review",
      origin: "reported",
      passed: true,
      summary: "looks good",
      at: "2026-09-18T00:02:00.000Z",
    },
  ],
  workspace: {
    baselineHead: "abc",
    currentHead: "abc",
    currentDirty: ["src/parser.ts"],
    changedDuringTask: ["src/parser.ts"],
    uncommittedTaskChanges: ["src/parser.ts"],
    taskCommitRequired: true,
    taskCommitPresent: false,
  },
};

test("scope drift state uses task authority and actual changes", () => {
  const state = projectObservationState("scopeDrift", packet, {
    diff: "@@ parser diff @@",
    context: [],
  }) as any;

  assert.equal(state.task.goal, "Update the parser only");
  assert.deepEqual(state.task.acceptance, ["Parser accepts the new syntax"]);
  assert.equal(state.task.current_stage.summary, "Parser implementation is in progress");
  assert.equal(state.task.current_stage.plan_authority, "hypothesis");
  assert.deepEqual(state.changes.changed_paths, ["src/parser.ts"]);
  assert.equal(state.changes.diff, "@@ parser diff @@");
});

test("verification gap state includes only executed verification", () => {
  const state = projectObservationState("verificationGap", packet, {
    context: [],
  }) as any;

  assert.equal(state.verification.length, 1);
  assert.equal(state.verification[0].provenance, "typecheck");
  assert.equal(state.verification[0].summary, "tsc --noEmit");
});

test("consistency state reuses observed repository evidence", () => {
  const state = projectObservationState("consistencyRisk", packet, {
    context: [
      {
        tool: "context",
        paths: ["src/parser.ts"],
        text: "export function parse() {}",
      },
    ],
  }) as any;

  assert.deepEqual(state.repository_evidence.observed_paths, [
    "src/parser.ts",
    "src/parser.test.ts",
  ]);
  assert.equal(
    state.repository_evidence.excerpts[0].text,
    "export function parse() {}",
  );
});
