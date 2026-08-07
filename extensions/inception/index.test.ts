import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import inceptionExtension from "./index.ts";
import {
  buildAgentStartPrompt,
  buildTurnBoundaryPrompt,
  classifyTool,
  createTurnObservation,
  observeToolResult,
} from "./prompts.ts";

test("agent-start prompt keeps core bias and adds request-specific guidance", () => {
  const prompt = buildAgentStartPrompt("この設計をリファクタしてバグも修正して");
  assert.match(prompt, /smallest complete change/);
  assert.match(prompt, /Repeated deterministic behavior belongs in code/);
  assert.match(prompt, /preserve observable behavior/);
  assert.match(prompt, /causal mechanism/);
});

test("tool classification distinguishes edits, checks, and async launches", () => {
  assert.equal(classifyTool("astrolabe", { action: "replace", replacement: "x" }), "mutation");
  assert.equal(classifyTool("astrolabe", { action: "locate", scope: "." }), "other");
  assert.equal(classifyTool("bash", { command: "bun run test" }), "verification");
  assert.equal(
    classifyTool("bash", { command: "bun run --cwd extensions/inception check" }),
    "verification",
  );
  assert.equal(
    classifyTool("background_process", { action: "start", command: "bun run typecheck" }),
    "other",
  );
  assert.equal(
    classifyTool("terminal", { action: "call", command: "bun run test" }),
    "other",
  );
});

test("turn-boundary prompt reacts to mutations and failures", () => {
  const observation = createTurnObservation();
  observeToolResult(observation, { toolName: "edit", input: {}, isError: false });
  observeToolResult(observation, {
    toolName: "bash",
    input: { command: "bun run test" },
    isError: true,
  });
  const prompt = buildTurnBoundaryPrompt(observation) ?? "";
  assert.match(prompt, /failed/);
  assert.match(prompt, /Project state changed/);
  assert.doesNotMatch(prompt, /Checks passed/);
});

test("turn-boundary prompt treats synchronous checks as evidence after mutation", () => {
  const observation = createTurnObservation();
  observeToolResult(observation, { toolName: "edit", input: {}, isError: false });
  observeToolResult(observation, {
    toolName: "bash",
    input: { command: "bun run --cwd extensions/inception check" },
    isError: false,
  });
  assert.match(buildTurnBoundaryPrompt(observation) ?? "", /Checks passed/);
});

test("extension injects baseline in system prompt and one transient reminder after mutation", async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const pi = {
    on(name: string, handler: (...args: any[]) => any) {
      handlers.set(name, handler);
    },
  } as unknown as ExtensionAPI;
  inceptionExtension(pi);

  const before = await handlers.get("before_agent_start")?.({
    prompt: "fix this",
    systemPrompt: "base",
  });
  assert.match(before.systemPrompt, /^base/);
  assert.match(before.systemPrompt, /<inception>/);

  await handlers.get("tool_result")?.({
    toolName: "edit",
    input: { path: "x.ts" },
    isError: false,
  });
  await handlers.get("turn_end")?.({});

  const firstContext = await handlers.get("context")?.({ messages: [] });
  assert.equal(firstContext.messages.length, 1);
  assert.equal(firstContext.messages[0].role, "custom");
  assert.equal(firstContext.messages[0].display, false);
  assert.match(firstContext.messages[0].content, /Project state changed/);

  const secondContext = await handlers.get("context")?.({ messages: [] });
  assert.equal(secondContext, undefined, "reminders are transient and consumed once");
});

test("read-only turns do not create reminder noise", async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const pi = {
    on(name: string, handler: (...args: any[]) => any) {
      handlers.set(name, handler);
    },
  } as unknown as ExtensionAPI;
  inceptionExtension(pi);

  await handlers.get("before_agent_start")?.({ prompt: "inspect this", systemPrompt: "base" });
  await handlers.get("tool_result")?.({
    toolName: "read",
    input: { path: "x.ts" },
    isError: false,
  });
  await handlers.get("turn_end")?.({});
  assert.equal(await handlers.get("context")?.({ messages: [] }), undefined);
});
