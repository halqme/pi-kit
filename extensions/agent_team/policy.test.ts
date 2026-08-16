import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolveSkill } from "./index.ts";
import {
  AGENT_TEAM_TOOL_NAMES,
  DEFAULT_AGENT_TEAM_THINKING,
  validateAgentTeamThinking,
  validateAgentTeamTools,
} from "./policy.ts";

test("child tool policy is safe by default and rejects unsupported tools", () => {
  assert.deepEqual(validateAgentTeamTools(), [...AGENT_TEAM_TOOL_NAMES]);
  assert.deepEqual(validateAgentTeamTools([]), []);
  assert.deepEqual(validateAgentTeamTools(["find", "find", "read"]), ["find", "read"]);
  assert.throws(
    () => validateAgentTeamTools(["bash"]),
    /child-safe read-only tools \(read, grep, find, ls\); unsupported: bash/,
  );
});

test("child thinking policy defaults to low and rejects unknown levels", () => {
  assert.equal(validateAgentTeamThinking(undefined), DEFAULT_AGENT_TEAM_THINKING);
  assert.equal(validateAgentTeamThinking("medium"), "medium");
  assert.throws(
    () => validateAgentTeamThinking("turbo"),
    /supports thinking levels: off, minimal, low, medium, high, xhigh, max; received: turbo/,
  );
});

test("bare skill names resolve from the project skill root", async () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
  assert.equal(
    await resolveSkill("writing-skills", repoRoot),
    join(repoRoot, "skills", "writing-skills", "SKILL.md"),
  );
});
