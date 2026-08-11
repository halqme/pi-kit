import assert from "node:assert/strict";
import test from "node:test";
import { analyzeLines, createReport, addToReport } from "../src/analyze.ts";
import { addResourceInventory } from "../src/resources.ts";
import { selectReport } from "../src/selection.ts";

function reportWithProjects() {
  const report = createReport();
  addToReport(
    report,
    analyzeLines([
      JSON.stringify({
        type: "session",
        id: "one",
        cwd: "/one",
        timestamp: "2026-01-01T00:00:00Z",
      }),
      JSON.stringify({ type: "turn_end" }),
    ]),
  );
  addToReport(
    report,
    analyzeLines([
      JSON.stringify({
        type: "session",
        id: "two",
        cwd: "/two",
        timestamp: "2026-01-02T00:00:00Z",
      }),
      JSON.stringify({ type: "turn_end" }),
    ]),
  );
  return report;
}

test("returns canonical JSON selection data and applies limit only to rows", () => {
  const result = selectReport(reportWithProjects(), {
    view: "projects",
    since: "2026-01-01",
    limit: 1,
  });
  assert.deepEqual(result.query, { view: "projects", since: "2026-01-01", limit: 1 });
  assert.equal((result.data as { kind: string }).kind, "projects");
  assert.equal((result.data as { rows: unknown[] }).rows.length, 1);
  assert.equal((result.data as { rows: Array<{ project: string }> }).rows[0]?.project, "/one");
});

test("selects logical operations as structured data", () => {
  const result = selectReport(reportWithProjects(), { view: "logical-operations" });
  assert.deepEqual(result.query, { view: "logical-operations" });
  assert.equal((result.data as { kind: string }).kind, "logical-operations");
  assert.equal((result.data as { metrics: { operations: number } }).metrics.operations, 0);
});

test("includes the same tool resource status in tool-action rows", () => {
  const report = createReport();
  addToReport(
    report,
    analyzeLines([
      JSON.stringify({ type: "session", id: "bash", cwd: "/repo" }),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "bash-1", name: "bash", arguments: {} }],
        },
      }),
    ]),
  );
  addResourceInventory(report, "/repo", {
    tools: { bash: { source: "builtin" } },
    skills: {},
    diagnostics: [],
  });

  const result = selectReport(report, { view: "tool-actions" });
  const row = (result.data as { rows: Array<{ status?: string }> }).rows[0];
  assert.equal(row?.status, "available");
});

test("rejects invalid query boundaries", () => {
  assert.throws(() => selectReport(createReport(), { since: "2026-99-99" }), /Invalid --since/);
  assert.throws(() => selectReport(createReport(), { limit: 0 }), /positive integer/);
});
