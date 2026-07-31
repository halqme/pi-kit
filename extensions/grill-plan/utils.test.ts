import assert from "node:assert/strict";
import test from "node:test";
import {
  extractPlanSteps,
  extractPlanText,
  filterTransientContextMessages,
  isSafeReadOnlyCommand,
  markCompletedStepNumbers,
  markCompletedSteps,
  parsePlanSidecar,
  planMarkdownFilename,
  planSidecarFilename,
  planSidecarMarkdown,
} from "./utils.ts";

const structuredPlan = `Resolved decisions:\n- Keep the API\n\n課題:\nAuthentication fails after refresh.\n\n原因:\nThe token is not restored.\n\n修正するべき点:\nRestore persisted authentication state.\n\n対処法:\nInitialize auth before routing.\n\n実際に編集するファイル:\n- src/auth.ts: restore the token\n- src/auth.test.ts: cover refresh\n\nPlan:\n1. Update \`src/auth.ts\`\n2. Run focused tests`;

test("keeps only durable messages when replacing per-turn plan context", () => {
  const durable = { role: "user", content: "keep me" };
  const messages = [
    durable,
    { customType: "grill-plan-context", content: "old planning instructions" },
    { customType: "grill-plan-context", content: "newer planning instructions" },
    { customType: "grill-plan-execute", content: "old execution trigger" },
    { customType: "grill-plan-execution-context", content: "old remaining steps" },
    { customType: "unrelated-extension", content: "keep this too" },
  ];

  assert.deepEqual(filterTransientContextMessages(messages), [durable, messages[5]]);
});

test("transient plan context does not grow across simulated turns", () => {
  let messages: Array<{ customType?: string; content: string }> = [
    { content: "original user request" },
  ];

  for (let turn = 0; turn < 20; turn += 1) {
    messages = [
      ...filterTransientContextMessages(messages),
      { customType: "grill-plan-context", content: `instructions for turn ${turn}` },
    ];
    assert.equal(
      messages.filter((message) => message.customType === "grill-plan-context").length,
      1,
    );
  }

  assert.equal(messages.length, 2);
});

test("allows conservative read-only commands and pipelines", () => {
  for (const command of [
    "rg -n plan src",
    "git status --short",
    "git diff --stat",
    "cat README.md | head -20",
  ]) {
    assert.equal(isSafeReadOnlyCommand(command), true, command);
  }
});

test("blocks writes, compound commands, substitutions, and ambiguous git branch creation", () => {
  for (const command of [
    "rm file",
    "cat README.md > copy.md",
    "cat README.md; touch file",
    "cat README.md & touch file",
    "echo $(touch file)",
    "git branch new-branch",
    "find . -delete",
    "find . -fprint report.txt",
    "fd pattern --exec rm {}",
    "rg --pre 'touch file' pattern",
    "sort input -o output",
    "diff a b --to-file=output",
    "git diff --output=patch.txt",
    "npm audit --fix",
    "rg foo || echo missing",
  ]) {
    assert.equal(isSafeReadOnlyCommand(command), false, command);
  }
});

test("extracts a structured plan and its numbered implementation steps", () => {
  assert.equal(
    extractPlanText(structuredPlan),
    structuredPlan.slice(structuredPlan.indexOf("課題:")),
  );
  assert.deepEqual(extractPlanSteps(structuredPlan), [
    { step: 1, text: "Update `src/auth.ts`", completed: false },
    { step: 2, text: "Run focused tests", completed: false },
  ]);
});

test("accepts markdown-styled structured plan headings", () => {
  const markdownPlan = structuredPlan.replace(
    /^(課題|原因|修正するべき点|対処法|実際に編集するファイル|Plan):/gm,
    "## $1:",
  );
  assert.ok(extractPlanText(markdownPlan));
  assert.deepEqual(extractPlanSteps(markdownPlan), [
    { step: 1, text: "Update `src/auth.ts`", completed: false },
    { step: 2, text: "Run focused tests", completed: false },
  ]);
});

test("rejects a final plan that omits a required structured section", () => {
  assert.equal(extractPlanText("課題:\nProblem\n\nPlan:\n1. Apply the fix"), undefined);
  assert.equal(
    extractPlanText(structuredPlan.replace("原因:\nThe token is not restored.", "原因:\n")),
    undefined,
  );
});

test("tracks each completed step once", () => {
  const steps = extractPlanSteps("Plan:\n1. Inspect files\n2. Apply patch");
  assert.equal(markCompletedSteps("[DONE:1] [DONE:1]", steps), 1);
  assert.equal(steps[0]?.completed, true);
  assert.equal(steps[1]?.completed, false);
});

test("records explicit progress updates idempotently", () => {
  const steps = extractPlanSteps("Plan:\n1. Inspect files\n2. Apply patch\n3. Run tests");
  assert.equal(markCompletedStepNumbers([1, 2, 2], steps), 2);
  assert.equal(markCompletedStepNumbers([2, 3], steps), 1);
  assert.deepEqual(
    steps.map((step) => step.completed),
    [true, true, true],
  );
});

test("validates versioned plan sidecars and exact step numbering", () => {
  const value = {
    version: 1,
    sourceSessionId: "019f-session",
    cwd: "/workspace",
    updatedAt: "2026-07-22T12:00:00.000Z",
    phase: "ready",
    goal: "Fix auth",
    planText: extractPlanText(structuredPlan),
    steps: extractPlanSteps(structuredPlan),
  };
  assert.deepEqual(parsePlanSidecar(value), value);
  assert.throws(() => parsePlanSidecar({ ...value, version: 2 }), /version/);
  assert.throws(
    () => parsePlanSidecar({ ...value, steps: [{ ...value.steps[0], step: 2 }] }),
    /step/,
  );
});

test("builds JSON and Markdown sidecar filenames only from safe session IDs", () => {
  assert.equal(planSidecarFilename("019f-session"), "019f-session.grill-plan.json");
  assert.equal(planMarkdownFilename("019f-session"), "019f-session.grill-plan.md");
  assert.throws(() => planSidecarFilename("../session"), /Invalid session ID/);
  assert.throws(() => planMarkdownFilename("../session"), /Invalid session ID/);
});

test("generates readable Markdown from the JSON sidecar snapshot", () => {
  const markdown = planSidecarMarkdown({
    version: 1,
    sourceSessionId: "019f-session",
    cwd: "/workspace",
    updatedAt: "2026-07-22T12:00:00.000Z",
    phase: "executing",
    goal: "Fix auth",
    planText: structuredPlan,
    steps: [
      { step: 1, text: "Update auth", completed: true },
      { step: 2, text: "Run tests", completed: false },
    ],
  });
  assert.match(markdown, /# Grill Plan/);
  assert.match(markdown, /Phase: `executing`/);
  assert.match(markdown, /Goal: Fix auth/);
  assert.match(markdown, /- \[x\] Update auth/);
  assert.match(markdown, /- \[ \] Run tests/);
  assert.match(markdown, /Authentication fails after refresh/);
});
