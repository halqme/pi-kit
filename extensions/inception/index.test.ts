import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import inceptionExtension from "./index.ts";
import { classifyTool, createTurnObservation, observeToolResult } from "./observation.ts";
import { buildAgentStartPrompt } from "./prompts/agent-start.ts";
import { buildTurnBoundaryPrompt } from "./prompts/turn-boundary.ts";

test("agent-start prompt injects the repo-managed policy only when it is missing", () => {
  const prompt = buildAgentStartPrompt();
  assert.match(prompt, /Follow the user's explicit request/);
  assert.match(prompt, /YAGNI/);

  const loaded = buildAgentStartPrompt([{ content: prompt }]);
  assert.equal(loaded, "");
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
  assert.equal(classifyTool("terminal", { action: "call", command: "bun run test" }), "other");
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
  assert.match(prompt, /human-authored/);
  assert.match(prompt, /ask the human/);
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
  assert.match(before.systemPrompt, /# Pi Kit Agent Policy/);
  assert.match(before.systemPrompt, /Follow the user's explicit request/);

  const alreadyLoaded = await handlers.get("before_agent_start")?.({
    prompt: "inspect this",
    systemPrompt: "base",
    systemPromptOptions: {
      contextFiles: [{ path: "/repo/AGENTS.md", content: before.systemPrompt }],
    },
  });
  assert.equal(alreadyLoaded, undefined);

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
