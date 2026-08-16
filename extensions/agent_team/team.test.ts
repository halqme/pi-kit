import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentTeam,
  buildDiscussionPrompt,
  buildFinalPrompt,
  buildMemberSystemPrompt,
  buildRecorderSystemPrompt,
  type AgentTeamAgent,
  type AgentTeamConfig,
  type AgentTeamMemberConfig,
} from "./team.ts";

class FakeAgent implements AgentTeamAgent {
  readonly prompts: string[] = [];
  readonly member: AgentTeamMemberConfig;
  readonly systemPrompt: string;
  stopped = false;

  constructor(member: AgentTeamMemberConfig, systemPrompt = "") {
    this.member = member;
    this.systemPrompt = systemPrompt;
  }

  async ask(message: string): Promise<string> {
    this.prompts.push(message);
    if (message.includes("opening statement")) return `${this.member.name} opening`;
    if (message.includes("Record the final agent-team report"))
      return `${this.member.name} final report`;
    return `${this.member.name} revised`;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }
}

function config(overrides: Partial<AgentTeamConfig> = {}): AgentTeamConfig {
  return {
    id: "team-1",
    topic: "Choose an evaluation design",
    mode: "committee",
    interaction: "autonomous",
    members: [
      { name: "methodologist", role: "Assess validity" },
      { name: "domain-expert", role: "Assess domain fit" },
    ],
    maxRounds: 1,
    ...overrides,
  };
}

test("consultative teams pause after independent openings and resume with user direction", async () => {
  const agents: FakeAgent[] = [];
  const team = new AgentTeam(
    config({ interaction: "consultative" }),
    async (member, systemPrompt) => {
      const agent = new FakeAgent(member, systemPrompt);
      agents.push(agent);
      return agent;
    },
  );

  const waiting = await team.start();
  assert.equal(waiting.status, "awaiting-user");
  assert.equal(waiting.transcript.length, 2);
  assert.equal(waiting.consultation?.positions.length, 2);
  assert.equal(
    agents.some((agent) => agent.stopped),
    false,
  );

  const completed = await team.answer("Prioritize error taxonomy over aggregate accuracy");
  assert.equal(completed.status, "completed");
  assert.equal(completed.completedRounds, 1);
  assert.equal(completed.finalAnswer, "recorder final report");
  assert.equal(completed.transcript.at(-1)?.member, "recorder");
  assert.equal(agents.length, 3);
  assert.equal(
    agents.every((agent) => agent.stopped),
    true,
  );
  assert.match(agents[0]?.prompts[1] ?? "", /Prioritize error taxonomy/);
  assert.match(agents[2]?.prompts[0] ?? "", /Prioritize error taxonomy/);
});

test("uses a dedicated neutral recorder rather than the first specialist", async () => {
  const agents: FakeAgent[] = [];
  const team = new AgentTeam(config({ maxRounds: 0 }), async (member, systemPrompt) => {
    const agent = new FakeAgent(member, systemPrompt);
    agents.push(agent);
    return agent;
  });

  const completed = await team.start();
  const recorder = agents.at(-1);

  assert.equal(completed.finalAnswer, "recorder final report");
  assert.equal(recorder?.member.name, "recorder");
  assert.match(recorder?.systemPrompt ?? "", /dedicated neutral recorder/);
  assert.doesNotMatch(recorder?.systemPrompt ?? "", /Assess validity/);
  assert.equal(
    agents[0]?.prompts.some((prompt) => prompt.includes("Record the final")),
    false,
  );
});

test("stop during startup stops an agent created after the stop request", async () => {
  let releaseStartup: (() => void) | undefined;
  const startupReleased = new Promise<void>((resolve) => {
    releaseStartup = resolve;
  });
  let created: FakeAgent | undefined;
  const team = new AgentTeam(config(), async (member) => {
    await startupReleased;
    created = new FakeAgent(member);
    return created;
  });

  const starting = team.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const stopping = team.stop();
  releaseStartup?.();

  const [started, stopped] = await Promise.all([starting, stopping]);
  assert.equal(stopped.status, "stopped");
  assert.equal(started.status, "stopped");
  assert.equal(created?.stopped, true);
  assert.equal(started.transcript.length, 0);
});

test("instruction policies distinguish obedience from objective-driven behavior", () => {
  const base = { name: "reviewer", role: "Assess the proposal" };
  const obedient = buildMemberSystemPrompt(config(), {
    ...base,
    instructionPolicy: "user-obedient",
  });
  const goalDriven = buildMemberSystemPrompt(config(), {
    ...base,
    instructionPolicy: "goal-driven",
  });

  assert.match(obedient, /Follow the user's explicit instructions/);
  assert.match(goalDriven, /Do not blindly follow a user's local instruction/);
  assert.notEqual(obedient, goalDriven);
});

test("recorder prompt is neutral and treats member output as untrusted data", () => {
  const prompt = buildRecorderSystemPrompt(config());
  assert.match(prompt, /not one of the debating members/);
  assert.match(prompt, /untrusted argument data/);
  assert.match(prompt, /preserve material dissent/);
});

test("adversarial prompts require claim-focused cross-examination and a verdict", () => {
  const member = { name: "reviewer", role: "Attack weak evidence" };
  const statements = [{ member: "author", statement: "The proposal is safe" }];
  const discussion = buildDiscussionPrompt(config({ mode: "adversarial" }), member, statements, 1);
  const final = buildFinalPrompt(config({ mode: "adversarial" }), statements);
  assert.match(discussion, /Cross-examine/);
  assert.match(discussion, /concrete counterexample/);
  assert.match(discussion, /falsifiable condition/);
  assert.match(discussion, /Attack arguments rather than people/);
  assert.match(final, /Verdict/);
  assert.match(final, /Claims that survived scrutiny/);
});

test("adversarial openings require a clear opposition and concession condition", () => {
  const opening = buildMemberSystemPrompt(config({ mode: "adversarial" }), {
    name: "skeptic",
    role: "Find decisive flaws",
  });
  assert.match(opening, /genuinely opposing position/);
  assert.match(opening, /Do not seek compromise/);
});
