import assert from "node:assert/strict";
import test from "node:test";
import { addToReport, analyzeLines, createReport } from "../src/analyze.ts";
import { selectReport } from "../src/selection.ts";

function toolPair(
  id: string,
  name: string,
  input: Record<string, unknown>,
  isError = false,
): string[] {
  return [
    JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "toolCall", id, name, arguments: input }],
      },
    }),
    JSON.stringify({
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: id,
        toolName: name,
        isError,
        content: [{ type: "text", text: isError ? "failed" : "ok" }],
      },
    }),
  ];
}

test("summarizes vNext runtime operations and verification provenance", () => {
  const metrics = analyzeLines([
    JSON.stringify({ type: "session", id: "vnext-1", timestamp: "2026-08-29T00:00:00Z" }),
    ...toolPair("context-1", "context", { action: "find", query: "state restore" }),
    ...toolPair("code-1", "code", { action: "edit", continuation: { token: "x" }, replacement: "y" }, true),
    ...toolPair("task-1", "task", { action: "checkpoint", summary: "replan" }),
    ...toolPair("verify-1", "verify", {
      action: "record",
      provenance: "typecheck",
      passed: true,
      summary: "tsc passed",
    }),
    ...toolPair("verify-2", "verify", {
      action: "record",
      provenance: "self_test",
      passed: false,
      summary: "new regression test failed",
    }),
    ...toolPair("delegate-1", "delegate", { action: "start", task: "isolated work" }),
  ]);

  assert.equal(metrics.vnext.context.actions.find?.calls, 1);
  assert.equal(metrics.vnext.code.actions.edit?.calls, 1);
  assert.equal(metrics.vnext.code.actions.edit?.errors, 1);
  assert.equal(metrics.vnext.task.actions.checkpoint?.calls, 1);
  assert.equal(metrics.vnext.delegate.actions.start?.calls, 1);
  assert.equal(metrics.vnext.verification.records, 2);
  assert.equal(metrics.vnext.verification.passed, 1);
  assert.equal(metrics.vnext.verification.failed, 1);
  assert.deepEqual(metrics.vnext.verification.byProvenance.typecheck, {
    records: 1,
    passed: 1,
    failed: 0,
    errors: 0,
  });
  assert.deepEqual(metrics.vnext.verification.byProvenance.self_test, {
    records: 1,
    passed: 0,
    failed: 1,
    errors: 0,
  });
});

test("exposes vNext metrics as a selectable report view", () => {
  const report = createReport();
  addToReport(
    report,
    analyzeLines([
      JSON.stringify({ type: "session", timestamp: "2026-08-29T00:00:00Z" }),
      ...toolPair("task-start", "task", { action: "start", goal: "ship" }),
    ]),
  );

  const selected = selectReport(report, { view: "vnext" });
  assert.equal(selected.data.kind, "vnext");
  if (selected.data.kind === "vnext") assert.equal(selected.data.metrics.task.actions.start?.calls, 1);
});
