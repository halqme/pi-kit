import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import agentTeamExtension from "./index.ts";

function captureTool(extra: Record<string, unknown> = {}): any {
  let tool: any;
  agentTeamExtension({
    on() {},
    registerTool(value: unknown) {
      tool = value;
    },
    ...extra,
  } as unknown as ExtensionAPI);
  assert.ok(tool);
  return tool;
}

test("agent-team propagates invalid start input as an execute error", async () => {
  const tool = captureTool();

  await assert.rejects(
    () =>
      tool.execute(
        "test-call",
        { action: "start", topic: "   ", members: [] },
        undefined,
        undefined,
        { ui: { setStatus() {} } },
      ),
    /topic is required for start/,
  );
});

test("agent-team exposes only child-safe read-only tools in the tool schema", () => {
  const tool = captureTool();
  const schema = JSON.stringify(tool.parameters);
  for (const name of ["read", "grep", "find", "ls"]) {
    assert.match(schema, new RegExp(`"${name}"`));
  }
  assert.doesNotMatch(schema, /"web_search"/);
  assert.doesNotMatch(schema, /"web_fetch"/);
  assert.doesNotMatch(schema, /"bash"/);
  assert.doesNotMatch(schema, /"astrolabe"/);
});

test("agent-team rejects unsafe tools when direct callers bypass schema validation", async () => {
  const tool = captureTool();

  await assert.rejects(
    () =>
      tool.execute(
        "test-call",
        {
          action: "start",
          topic: "Review this change",
          members: [
            { name: "a", role: "reviewer" },
            { name: "b", role: "skeptic" },
          ],
          tools: ["bash"],
        },
        undefined,
        undefined,
        { ui: { setStatus() {} } },
      ),
    /child-safe read-only tools \(read, grep, find, ls\); unsupported: bash/,
  );
});

test("agent-team reports missing team skills without creating a job", async () => {
  const tool = captureTool();
  const ctx = {
    cwd: "/tmp/pi-kit-agent-team-skill-preflight-team",
    ui: { setStatus() {} },
  };
  const result = await tool.execute(
    "team-skill-call",
    {
      action: "start",
      topic: "Review the skill preflight boundary",
      skills: ["missing-team-skill"],
      members: [
        { name: "reviewer", role: "Review the failure" },
        { name: "skeptic", role: "Challenge the recovery" },
      ],
    },
    undefined,
    undefined,
    ctx,
  );

  assert.equal(result.details.status, "failed");
  assert.equal(result.details.phase, "preflight");
  const diagnostic = result.details.diagnostics[0];
  assert.equal(diagnostic.scope, "team");
  assert.equal(diagnostic.skill, "missing-team-skill");
  assert.equal(diagnostic.cwd, ctx.cwd);
  assert.ok(diagnostic.searchedCandidates.length >= 1);
  assert.match(diagnostic.recovery, /existing SKILL\.md/);
  assert.match(result.content[0].text, /Searched candidates:/);

  const listed = await tool.execute("list-call", { action: "list" }, undefined, undefined, ctx);
  assert.deepEqual(listed.details, []);
});

test("agent-team reports missing member skills with member scope", async () => {
  const tool = captureTool();
  const ctx = {
    cwd: "/tmp/pi-kit-agent-team-skill-preflight-member",
    ui: { setStatus() {} },
  };
  const result = await tool.execute(
    "member-skill-call",
    {
      action: "start",
      topic: "Review member skill diagnostics",
      members: [
        {
          name: "missing-reviewer",
          role: "Review the failure",
          skills: ["missing-member-skill"],
        },
        { name: "skeptic", role: "Challenge the recovery" },
      ],
    },
    undefined,
    undefined,
    ctx,
  );

  assert.equal(result.details.status, "failed");
  assert.equal(result.details.phase, "preflight");
  const diagnostic = result.details.diagnostics[0];
  assert.equal(diagnostic.scope, "member");
  assert.equal(diagnostic.member, "missing-reviewer");
  assert.equal(diagnostic.skill, "missing-member-skill");
  assert.equal(diagnostic.cwd, ctx.cwd);
  assert.ok(diagnostic.searchedCandidates.length >= 1);

  const listed = await tool.execute("list-call", { action: "list" }, undefined, undefined, ctx);
  assert.deepEqual(listed.details, []);
});

test("agent-team reports malformed team models before creating a job", async () => {
  const tool = captureTool();
  const ctx = { cwd: "/tmp/pi-kit-agent-team-model-preflight-team", ui: { setStatus() {} } };
  const result = await tool.execute(
    "team-model-call",
    {
      action: "start",
      topic: "Review model selection",
      model: "model-only",
      members: [
        { name: "reviewer", role: "Review the failure" },
        { name: "skeptic", role: "Challenge the recovery" },
      ],
    },
    undefined,
    undefined,
    ctx,
  );

  assert.equal(result.details.status, "failed");
  assert.equal(result.details.phase, "preflight");
  const diagnostic = result.details.diagnostics[0];
  assert.equal(diagnostic.scope, "team");
  assert.equal(diagnostic.model, "model-only");
  assert.match(diagnostic.recovery, /provider\/model/);
  assert.match(result.content[0].text, /model preflight failed/);

  const listed = await tool.execute("list-call", { action: "list" }, undefined, undefined, ctx);
  assert.deepEqual(listed.details, []);
});

test("agent-team reports malformed member models with member scope", async () => {
  const tool = captureTool();
  const ctx = { cwd: "/tmp/pi-kit-agent-team-model-preflight-member", ui: { setStatus() {} } };
  const result = await tool.execute(
    "member-model-call",
    {
      action: "start",
      topic: "Review member model selection",
      members: [
        { name: "bad-reviewer", role: "Review the failure", model: "provider/" },
        { name: "skeptic", role: "Challenge the recovery" },
      ],
    },
    undefined,
    undefined,
    ctx,
  );

  assert.equal(result.details.status, "failed");
  assert.equal(result.details.phase, "preflight");
  const diagnostic = result.details.diagnostics[0];
  assert.equal(diagnostic.scope, "member");
  assert.equal(diagnostic.member, "bad-reviewer");
  assert.equal(diagnostic.model, "provider/");
  assert.match(diagnostic.recovery, /child default/);

  const listed = await tool.execute("list-call", { action: "list" }, undefined, undefined, ctx);
  assert.deepEqual(listed.details, []);
});
