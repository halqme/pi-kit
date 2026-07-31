import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { SubagentRpcClient } from "./subagent-rpc.ts";

type Listener = (data: unknown) => void;

class FakeEvents {
  private readonly listeners = new Map<string, Set<Listener>>();
  readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  private runNumber = 0;
  holdCompletion = false;

  on(event: string, listener: Listener): () => void {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }

  emit(event: string, data: unknown): void {
    if (event === "subagents:rpc:v1:request") {
      const request = data as {
        requestId: string;
        method: string;
        params?: Record<string, unknown>;
      };
      this.requests.push({ method: request.method, params: request.params ?? {} });
      if (request.method === "ping") {
        this.reply(request.requestId, { events: { asyncComplete: "subagent:async-complete" } });
      } else if (request.method === "spawn") {
        const runId = `run-${++this.runNumber}`;
        const output = String(request.params?.output);
        void writeFile(output, "member response", "utf8").then(() => {
          this.reply(request.requestId, { details: { runId, asyncId: runId } });
          if (!this.holdCompletion)
            this.emit("subagent:async-complete", { runId, state: "complete" });
        });
      } else if (request.method === "status") {
        this.reply(request.requestId, { text: "Run complete", details: { state: "complete" } });
      } else if (request.method === "stop") {
        this.reply(request.requestId, { text: "Stop requested", details: { state: "stopped" } });
      }
      return;
    }

    for (const listener of this.listeners.get(event) ?? []) listener(data);
  }

  private reply(requestId: string, data: Record<string, unknown>): void {
    this.emit(`subagents:rpc:v1:reply:${requestId}`, {
      version: 1,
      requestId,
      success: true,
      data,
    });
  }
}

test("runs member prompts through tracked async subagents", async () => {
  const events = new FakeEvents();
  const client = new SubagentRpcClient(events, 5_000);
  const member = await client.startMember({
    member: { name: "reviewer", role: "Review the proposal" },
    systemPrompt: "You are reviewer.",
    cwd: process.cwd(),
    model: "openai-codex/test-model",
    thinking: "low",
    timeoutMs: 5_000,
    tools: ["read"],
  });

  assert.equal(await member.ask("Give your opening statement"), "member response");
  assert.deepEqual(
    events.requests.map((request) => request.method),
    ["ping", "spawn", "status"],
  );
  const spawn = events.requests.find((request) => request.method === "spawn");
  assert.equal(spawn?.params.agent, "oracle");
  assert.equal(spawn?.params.async, true);
  assert.equal(spawn?.params.outputMode, "file-only");
  assert.match(String(spawn?.params.task), /Give your opening statement/);

  await member.stop();
  client.dispose();
});

test("aborts and stops an active async run", async () => {
  const events = new FakeEvents();
  events.holdCompletion = true;
  const client = new SubagentRpcClient(events, 5_000);

  const member = await client.startMember({
    member: { name: "reviewer", role: "Review the proposal" },
    systemPrompt: "You are reviewer.",
    cwd: process.cwd(),
    timeoutMs: 5_000,
  });
  const controller = new AbortController();
  const pending = member.ask("Start", controller.signal);
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort();

  await assert.rejects(pending, /Agent request aborted/);
  assert.ok(events.requests.some((request) => request.method === "stop"));
  client.dispose();
});
