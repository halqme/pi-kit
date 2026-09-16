import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeDiagnosticLine,
  createSessionDiagnostics,
  createSessionDiagnosticsSummary,
  mergeSessionDiagnostics,
  RUNTIME_FINGERPRINT_ENTRY,
} from "../src/diagnostics.ts";

test("classifies only explicit classes and stable Pi Kit error prefixes", () => {
  const diagnostics = createSessionDiagnostics();
  for (const message of [
    {
      role: "toolResult",
      isError: true,
      details: { errorClass: "precondition" },
      content: [{ type: "text", text: "anything" }],
    },
    {
      role: "toolResult",
      isError: true,
      content: [{ type: "text", text: "execution_failure: check failed" }],
    },
    {
      role: "toolResult",
      isError: true,
      content: [{ type: "text", text: "unsupported_language: Swift" }],
    },
    {
      role: "toolResult",
      isError: true,
      content: [{ type: "text", text: "plain unclassified failure" }],
    },
  ]) {
    analyzeDiagnosticLine(diagnostics, JSON.stringify({ type: "message", message }));
  }

  assert.equal(diagnostics.errors.total, 4);
  assert.equal(diagnostics.errors.classified, 3);
  assert.equal(diagnostics.errors.unknown, 1);
  assert.equal(diagnostics.errors.byClass.precondition, 1);
  assert.equal(diagnostics.errors.byClass.execution_failure, 1);
  assert.equal(diagnostics.errors.byClass.agent_misuse, 1);
  assert.equal(diagnostics.errors.byClass.expected_failure, 0);
});

test("records unique runtime fingerprints and aggregates sessions by fingerprint", () => {
  const first = createSessionDiagnostics();
  const entry = JSON.stringify({
    type: "custom",
    customType: RUNTIME_FINGERPRINT_ENTRY,
    data: {
      revision: "0123456789abcdef",
      fingerprint: "0123456789ab+deadbeefcafe",
      dirty: true,
      capturedAt: "2026-09-16T00:00:00.000Z",
    },
  });
  analyzeDiagnosticLine(first, entry);
  analyzeDiagnosticLine(first, entry);

  const second = createSessionDiagnostics();
  analyzeDiagnosticLine(second, entry);

  const summary = createSessionDiagnosticsSummary();
  mergeSessionDiagnostics(summary, first);
  mergeSessionDiagnostics(summary, second);

  assert.equal(first.fingerprints.length, 1);
  assert.equal(summary.revisions["0123456789ab+deadbeefcafe"]?.sessions, 2);
  assert.equal(summary.revisions["0123456789ab+deadbeefcafe"]?.dirty, true);
});
