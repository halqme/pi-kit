import assert from "node:assert/strict";
import test from "node:test";

import { runOsaProcess } from "./core.ts";

const macOnly = { skip: process.platform !== "darwin" };
const cwd = process.cwd();

test("real AppleScript errors surface as failed process results", macOnly, async () => {
  const result = await runOsaProcess({
    language: "applescript",
    script: 'error "pi-kit-integration-boom"',
    timeoutMs: 5_000,
    cwd,
  });

  assert.equal(result.ok, false);
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.aborted, false);
  assert.match(result.stderr, /pi-kit-integration-boom/);
});

test("real JXA exceptions surface as failed process results", macOnly, async () => {
  const result = await runOsaProcess({
    language: "javascript",
    script: 'throw new Error("pi-kit-jxa-boom")',
    timeoutMs: 5_000,
    cwd,
  });

  assert.equal(result.ok, false);
  assert.notEqual(result.exitCode, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.aborted, false);
  assert.match(result.stderr, /pi-kit-jxa-boom/);
});

test("real osascript timeout is marked as an error", macOnly, async () => {
  const result = await runOsaProcess({
    language: "applescript",
    script: "delay 1\nreturn 1",
    timeoutMs: 100,
    cwd,
  });

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.aborted, false);
});

test("real osascript abort is marked as an error", macOnly, async () => {
  const controller = new AbortController();
  const pending = runOsaProcess({
    language: "applescript",
    script: "delay 1\nreturn 1",
    timeoutMs: 5_000,
    cwd,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50).unref();
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(result.timedOut, false);
  assert.equal(result.aborted, true);
});
