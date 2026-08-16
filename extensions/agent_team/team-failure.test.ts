import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentTeam,
  type AgentTeamAgent,
  type AgentTeamConfig,
  type AgentTeamMemberConfig,
} from "./team.ts";

class ControlledAgent implements AgentTeamAgent {
  readonly member: AgentTeamMemberConfig;
  readonly shouldFail: boolean;
  readonly shouldFailStop: boolean;
  askCount = 0;
  stopped = false;

  constructor(member: AgentTeamMemberConfig, shouldFail: boolean, shouldFailStop = false) {
    this.member = member;
    this.shouldFail = shouldFail;
    this.shouldFailStop = shouldFailStop;
  }

  async ask(prompt: string): Promise<string> {
    this.askCount += 1;
    if (this.shouldFail) throw new Error("provider unavailable");
    if (prompt.includes("Record the final agent-team report")) return "final report";
    if (prompt.includes("opening statement")) return `${this.member.name} opening`;
    return `${this.member.name} discussion`;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.shouldFailStop) throw new Error("stop unavailable");
  }
}

function config(members: AgentTeamMemberConfig[]): AgentTeamConfig {
  return {
    id: "failure-team",
    topic: "Test failure recovery",
    mode: "committee",
    interaction: "autonomous",
    members,
    maxRounds: 1,
    tools: ["read"],
    thinking: "low",
  };
}

test("one failed member is recorded while other members complete the team", async () => {
  const agents: ControlledAgent[] = [];
  const team = new AgentTeam(
    config([
      { name: "broken", role: "unavailable provider" },
      { name: "healthy", role: "reviewer" },
    ]),
    async (member) => {
      const agent = new ControlledAgent(member, member.name === "broken");
      agents.push(agent);
      return agent;
    },
  );

  const result = await team.start();

  assert.equal(result.status, "completed");
  assert.equal(result.completedRounds, 1);
  assert.equal(result.memberErrors?.broken, "provider unavailable");
  assert.equal(agents.find((agent) => agent.member.name === "broken")?.askCount, 1);
  assert.match(
    result.transcript.find((statement) => statement.member === "broken")?.text ?? "",
    /failed: provider unavailable/,
  );
  assert.equal(result.finalAnswer, "final report");
  assert.equal(
    agents.every((agent) => agent.stopped),
    true,
  );
});

test("all member failures fail the phase with the collected diagnostics", async () => {
  const team = new AgentTeam(
    config([
      { name: "broken-a", role: "unavailable provider" },
      { name: "broken-b", role: "unavailable provider" },
    ]),
    async (member) => new ControlledAgent(member, true),
  );

  await assert.rejects(
    team.start(),
    /opening phase failed: provider unavailable; provider unavailable/,
  );
  const result = team.snapshot();
  assert.equal(result.status, "failed");
  assert.deepEqual(result.memberErrors, {
    "broken-a": "provider unavailable",
    "broken-b": "provider unavailable",
  });
});

test("stop failures are retained as member diagnostics", async () => {
  const team = new AgentTeam(
    config([
      { name: "stop-broken", role: "stop failure" },
      { name: "healthy", role: "reviewer" },
    ]),
    async (member) => new ControlledAgent(member, false, member.name === "stop-broken"),
  );

  const result = await team.start();
  assert.equal(result.status, "completed");
  assert.equal(result.memberErrors?.["stop-broken"], "stop failed: stop unavailable");
});
