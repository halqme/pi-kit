import assert from "node:assert/strict";
import test from "node:test";
import {
  HerdrAgentController,
  buildDelegationPrompt,
  validateName,
  type HerdrClient,
} from "./controller.ts";
import type { HerdrResponse } from "./herdr-cli.ts";

class FakeClient implements HerdrClient {
  readonly calls: Array<{ kind: "json" | "text"; args: string[] }> = [];
  readonly responses: Array<HerdrResponse | string> = [];

  async json(args: string[]): Promise<HerdrResponse> {
    this.calls.push({ kind: "json", args });
    const response = this.responses.shift();
    if (typeof response === "string" || response === undefined) {
      throw new Error("missing JSON response");
    }
    return response;
  }

  async text(args: string[]): Promise<string> {
    this.calls.push({ kind: "text", args });
    const response = this.responses.shift();
    if (typeof response !== "string") throw new Error("missing text response");
    return response;
  }
}

const agent = {
  name: "worker",
  agent_status: "working",
  workspace_id: "w2",
  pane_id: "w2:p1",
  cwd: "/tmp/worktree",
  agent: "pi",
};

test("starts a Pi agent in an isolated Herdr worktree", async () => {
  const client = new FakeClient();
  client.responses.push(
    {
      result: {
        workspace: { workspace_id: "w2" },
        root_pane: { pane_id: "w2:p1" },
        worktree: { path: "/tmp/worktree", branch: "pi/worker" },
      },
    },
    { result: { agent } },
    { result: { agent } },
  );

  const controller = new HerdrAgentController(client);
  const result = await controller.start({
    name: "worker",
    task: "Implement the parser",
    cwd: "/repo",
    model: "openai-codex/gpt-5.6-sol:high",
  });

  assert.equal(result.workspaceId, "w2");
  assert.equal(result.branch, "pi/worker");
  assert.deepEqual(client.calls[0]?.args, [
    "worktree",
    "create",
    "--cwd",
    "/repo",
    "--label",
    "pi-agent:worker",
    "--no-focus",
  ]);
  assert.deepEqual(client.calls[1]?.args, [
    "agent",
    "start",
    "worker",
    "--kind",
    "pi",
    "--pane",
    "w2:p1",
    "--timeout",
    "30000",
    "--",
    "--model",
    "openai-codex/gpt-5.6-sol:high",
  ]);
  assert.equal(client.calls[2]?.args[0], "agent");
  assert.match(client.calls[2]?.args[3] ?? "", /Implement the parser/);
});

test("checks lifecycle state and bounded terminal output", async () => {
  const client = new FakeClient();
  client.responses.push({ result: { agent } }, "finished\n");
  const controller = new HerdrAgentController(client);

  const result = await controller.check("worker", 120);

  assert.equal(result.agent.status, "working");
  assert.equal(result.output, "finished\n");
  assert.deepEqual(client.calls[1]?.args, [
    "agent",
    "read",
    "worker",
    "--source",
    "visible",
    "--lines",
    "120",
  ]);
});

test("validates Herdr agent names", () => {
  assert.doesNotThrow(() => validateName("reviewer-1"));
  assert.throws(() => validateName("Reviewer"));
});

test("delegation prompt preserves the task and safety boundary", () => {
  const prompt = buildDelegationPrompt("Change src/index.ts");
  assert.match(prompt, /Change src\/index.ts/);
  assert.match(prompt, /Do not merge branches/);
});

test("preserves the worktree when the initial prompt fails", async () => {
  const client = new FakeClient();
  client.responses.push(
    {
      result: {
        workspace: { workspace_id: "w2" },
        root_pane: { pane_id: "w2:p1" },
        worktree: { path: "/tmp/worktree", branch: "pi/worker" },
      },
    },
    { result: { agent } },
  );
  client.json = async (args: string[]): Promise<HerdrResponse> => {
    client.calls.push({ kind: "json", args });
    if (args[0] === "agent" && args[1] === "prompt") throw new Error("prompt failed");
    const response = client.responses.shift();
    if (typeof response === "string" || response === undefined) {
      throw new Error("missing JSON response");
    }
    return response;
  };

  const controller = new HerdrAgentController(client);
  await assert.rejects(
    controller.start({ name: "worker", task: "Implement it", cwd: "/repo" }),
    /prompt failed/,
  );
  assert.equal(
    client.calls.some((call) => call.args[0] === "worktree" && call.args[1] === "remove"),
    false,
  );
});
