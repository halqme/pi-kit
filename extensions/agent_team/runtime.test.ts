import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  atomicWriteJson,
  inspectProcess,
  startBackgroundProcess,
} from "@halqme/background_process";
import { agentTeamTaskRoot } from "./pi-runner.ts";
import { createAgentTeamJob, refreshAgentTeamJobs, type AgentTeamJob } from "./runtime.ts";
import type { AgentTeamConfig } from "./team.ts";

async function waitForUnchecked(taskDir: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await inspectProcess(taskDir)).phase === "unchecked") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("background process did not finish");
}

function config(): AgentTeamConfig {
  return {
    id: "team-1",
    topic: "Assess the detached worker",
    mode: "committee",
    interaction: "autonomous",
    members: [
      { name: "reviewer", role: "Assess the design" },
      { name: "skeptic", role: "Find failure modes" },
    ],
    maxRounds: 1,
    tools: [],
    timeoutMs: 10_000,
  };
}

test("refreshes detached team state and acknowledges worker completion", async (t) => {
  const sessionDir = await mkdtemp(join("/tmp", "agent-team-runtime-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const sessionId = "session-1";
  const ctx = {
    cwd: sessionDir,
    ui: { setStatus() {} },
    sessionManager: {
      getEntries: () => [],
      getSessionDir: () => sessionDir,
      getSessionId: () => sessionId,
    },
  } as unknown as ExtensionContext;
  const job = createAgentTeamJob(ctx, config(), { status: "starting" });
  job.runtime = { operationId: "team-1", cwd: sessionDir };
  const jobs = new Map<string, AgentTeamJob>([[job.team.snapshot().id, job]]);
  const root = agentTeamTaskRoot(sessionDir, sessionId);
  const statePath = join(root, ".team-team-1.json");
  await atomicWriteJson(statePath, {
    ...job.team.persisted(),
    status: "completed",
    finalAnswer: "detached worker report",
  });
  const started = await startBackgroundProcess({
    taskRoot: root,
    ownerSessionId: sessionId,
    cwd: sessionDir,
    id: "team-1",
    kind: "agent-team",
    spec: { type: "shell", command: "true" },
  });
  await waitForUnchecked(started.taskDir);

  const messages: Array<{ message: unknown; options: unknown }> = [];
  const pi = {
    appendEntry() {},
    sendMessage(message: unknown, options: unknown) {
      messages.push({ message, options });
    },
  } as unknown as ExtensionAPI;
  await refreshAgentTeamJobs(pi, ctx, jobs, { notify: true });

  assert.equal(job.team.snapshot().status, "completed");
  assert.equal(job.team.snapshot().finalAnswer, "detached worker report");
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0]?.options, { triggerTurn: true, deliverAs: "followUp" });
  assert.equal((await inspectProcess(started.taskDir)).phase, "completed");
});
