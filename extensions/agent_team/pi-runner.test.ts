import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { agentTeamTaskRoot, ensureAgentTeamTaskRoot } from "./pi-runner.ts";

test("creates the agent-team task root in session storage without project files", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "agent-team-project-"));
  const sessionDir = await mkdtemp(join(tmpdir(), "agent-team-session-"));
  try {
    const taskRoot = agentTeamTaskRoot(sessionDir, "session-1");
    await ensureAgentTeamTaskRoot(taskRoot);

    assert.equal(taskRoot, join(sessionDir, "agent-team", "session-1"));
    await access(taskRoot);
    await assert.rejects(access(join(projectRoot, ".pi", "agent-team")), { code: "ENOENT" });
    await assert.rejects(access(join(sessionDir, "agent-team", ".gitignore")), { code: "ENOENT" });
  } finally {
    await Promise.all([
      rm(projectRoot, { recursive: true, force: true }),
      rm(sessionDir, { recursive: true, force: true }),
    ]);
  }
});
