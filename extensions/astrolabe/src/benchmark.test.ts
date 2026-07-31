import test from "node:test";
import assert from "node:assert/strict";
import { formatBenchmark, runBenchmark } from "./benchmark.ts";

test("runs the A/B/C benchmark matrix and reports selectable strategies", async () => {
  const results = await runBenchmark(["A", "B", "C"], { typeCheck: false, parseIterations: 2 });
  assert.equal(results.length, 27);
  assert.ok(results.filter((result) => result.success).every((result) => result.syntaxValid));
  assert.ok(
    results
      .filter((result) => result.mode === "A")
      .every((result) => result.selectedMode === "diff"),
  );
  const astrolabeResults = results.filter((result) => result.mode === "B");
  assert.ok(astrolabeResults.every((result) => result.selectedMode === "astrolabe"));
  assert.ok(
    astrolabeResults
      .filter((result) => result.applicability === "applicable")
      .every((result) => result.success),
  );
  assert.equal(
    astrolabeResults.find((result) => result.caseId === "new-file")?.applicability,
    "not_applicable",
  );
  assert.equal(
    results.find((result) => result.mode === "C" && result.caseId === "new-file")?.selectedMode,
    "diff",
  );
  assert.equal(
    results.find((result) => result.mode === "C" && result.caseId === "replace-expression")
      ?.selectedMode,
    "astrolabe",
  );
});

test("formats benchmark results as table and JSON and can run a test command", async () => {
  const results = await runBenchmark(["C"], {
    typeCheck: false,
    parseIterations: 2,
    testCommand: [process.execPath, "-e", "process.exit(0)"],
  });
  assert.match(formatBenchmark(results, "table"), /task\s+\| mode/);
  assert.equal(JSON.parse(formatBenchmark(results, "json")).results.length, results.length);
  assert.ok(results.every((result) => result.tests === "pass"));
});
