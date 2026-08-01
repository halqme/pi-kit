import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { agentTeamTaskRoot, ensureAgentTeamTaskRoot } from "./pi-runner.ts";

test("creates the agent-team task root with a gitignore", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "agent-team-"));
  try {
    const taskRoot = agentTeamTaskRoot(cwd, "session-1");
    await ensureAgentTeamTaskRoot(taskRoot);

    assert.equal(taskRoot, join(cwd, ".pi", "agent-team", "session-1"));
    assert.equal(await readFile(join(dirname(taskRoot), ".gitignore"), "utf8"), "*");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
