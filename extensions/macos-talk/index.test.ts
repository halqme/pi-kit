import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { normalizeTimeout, parseJsonStdout, type OsaRunRequest } from "./core.ts";
import macosTalkExtension, { setMacOSTalkRuntimeForTests } from "./index.ts";

type CapturedTool = {
  execute: (...args: unknown[]) => Promise<{
    content: Array<{ type: string; text?: string }>;
    details: Record<string, unknown>;
    isError?: boolean;
  }>;
};

function registerTool(): { tool: CapturedTool; ctx: ExtensionContext } {
  let captured: CapturedTool | undefined;
  const pi = {
    registerTool(tool: CapturedTool) {
      captured = tool;
    },
  } as unknown as ExtensionAPI;
  macosTalkExtension(pi);
  assert.ok(captured);
  return {
    tool: captured,
    ctx: { cwd: "/tmp/project" } as unknown as ExtensionContext,
  };
}

test("executes AppleScript by default and exposes JSON stdout as value", async (t) => {
  t.after(() => setMacOSTalkRuntimeForTests());
  let request: OsaRunRequest | undefined;
  setMacOSTalkRuntimeForTests({
    platform: "darwin",
    async run(next) {
      request = next;
      return {
        ok: true,
        language: next.language,
        stdout: '{"running":true,"windows":2}',
        stderr: "",
        exitCode: 0,
        durationMs: 12,
        timedOut: false,
        aborted: false,
      };
    },
  });
  const { tool, ctx } = registerTool();

  const result = await tool.execute(
    "call-1",
    { script: 'tell application "System Events" to return 1' },
    undefined,
    undefined,
    ctx,
  );

  assert.equal(request?.language, "applescript");
  assert.equal(request?.timeoutMs, 30_000);
  assert.equal(request?.cwd, "/tmp/project");
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.details.value, { running: true, windows: 2 });
  assert.match(result.content[0]?.text ?? "", /"running": true/);
});

test("passes JXA through unchanged and preserves execution failure I/O", async (t) => {
  t.after(() => setMacOSTalkRuntimeForTests());
  let request: OsaRunRequest | undefined;
  setMacOSTalkRuntimeForTests({
    platform: "darwin",
    async run(next) {
      request = next;
      return {
        ok: false,
        language: next.language,
        stdout: "partial output",
        stderr: "execution error: not permitted (-1743)",
        exitCode: 1,
        durationMs: 8,
        timedOut: false,
        aborted: false,
      };
    },
  });
  const { tool, ctx } = registerTool();
  const script = "Application('System Events').processes.length";

  const result = await tool.execute(
    "call-2",
    { language: "javascript", script, timeoutMs: 5_000 },
    undefined,
    undefined,
    ctx,
  );

  assert.equal(request?.language, "javascript");
  assert.equal(request?.script, script);
  assert.equal(request?.timeoutMs, 5_000);
  assert.equal(result.isError, true);
  assert.equal(result.details.stdout, "partial output");
  assert.equal(result.details.stderr, "execution error: not permitted (-1743)");
  assert.equal(result.details.value, undefined);
});

test("rejects use outside macOS before executing a script", async (t) => {
  t.after(() => setMacOSTalkRuntimeForTests());
  let called = false;
  setMacOSTalkRuntimeForTests({
    platform: "linux",
    async run(next) {
      called = true;
      throw new Error(`unexpected execution: ${next.script}`);
    },
  });
  const { tool, ctx } = registerTool();

  await assert.rejects(
    tool.execute("call-3", { script: "return 1" }, undefined, undefined, ctx),
    /requires macOS/,
  );
  assert.equal(called, false);
});

test("normalizes timeouts and parses only complete JSON stdout", () => {
  assert.equal(normalizeTimeout(undefined), 30_000);
  assert.equal(normalizeTimeout(100), 100);
  assert.equal(normalizeTimeout(120_000), 120_000);
  assert.throws(() => normalizeTimeout(99), /between 100 and 120000/);
  assert.throws(() => normalizeTimeout(120_001), /between 100 and 120000/);
  assert.deepEqual(parseJsonStdout("  [1,2,3]\n"), [1, 2, 3]);
  assert.equal(parseJsonStdout("not json"), undefined);
  assert.equal(parseJsonStdout(""), undefined);
});
