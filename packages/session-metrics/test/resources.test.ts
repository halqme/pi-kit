import assert from "node:assert/strict";
import test from "node:test";
import { addToReport, analyzeLines, createReport } from "../src/analyze.ts";
import { addResourceInventory } from "../src/resources.ts";

test("keeps historical usage while marking available missing and unused resources", () => {
  const report = createReport();
  addToReport(
    report,
    analyzeLines([
      JSON.stringify({ type: "session", id: "s1", cwd: "/repo" }),
      JSON.stringify({
        type: "message",
        message: {
          role: "user",
          content: [{ type: "text", text: "/skill:old-skill /skill:used-skill" }],
        },
      }),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "old", name: "old_tool", arguments: {} },
            { type: "toolCall", id: "used", name: "used_tool", arguments: {} },
          ],
        },
      }),
    ]),
  );

  addResourceInventory(report, "/repo", {
    tools: {
      used_tool: { source: "extension" },
      current_tool: { source: "extension" },
    },
    skills: {
      "used-skill": { source: "local" },
      "current-skill": { source: "local" },
    },
    diagnostics: [],
  });

  assert.equal(report.toolUsage.old_tool?.calls, 1);
  assert.equal(report.skills["old-skill"]?.explicit, 1);
  assert.equal(report.resources?.tools.old_tool?.status, "missing");
  assert.equal(report.resources?.tools.used_tool?.status, "available");
  assert.equal(report.resources?.tools.current_tool?.status, "unused");
  assert.equal(report.resources?.skills["old-skill"]?.status, "missing");
  assert.equal(report.resources?.skills["used-skill"]?.status, "available");
  assert.equal(report.resources?.skills["current-skill"]?.status, "unused");
  assert.equal(report.resources?.scope, "/repo");
});

test("uses selected history while cwd only selects the current inventory scope", () => {
  const report = createReport();
  addToReport(
    report,
    analyzeLines([
      JSON.stringify({ type: "session", id: "elsewhere", cwd: "/other" }),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "call", name: "shared_tool", arguments: {} }],
        },
      }),
    ]),
  );

  addResourceInventory(report, "/repo", {
    tools: { shared_tool: { source: "extension" } },
    skills: {},
    diagnostics: [],
  });

  assert.equal(report.resources?.tools.shared_tool?.calls, 1);
  assert.equal(report.resources?.tools.shared_tool?.status, "available");
});
