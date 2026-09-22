import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acknowledgeProcess,
  atomicWriteJson,
  inspectProcess,
  listProcesses,
  readProcessOutput,
  requestProcessStop,
  startBackgroundProcess,
  taskPath,
  type ProcessPhase,
} from "./core.ts";

test("task IDs cannot escape their registry", () => {
  assert.throws(() => taskPath("/tmp/tasks", "../outside"), /Invalid/);
});

async function waitForPhase(taskDir: string, phase: ProcessPhase, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await inspectProcess(taskDir);
    if (snapshot.phase === phase) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${phase}`);
}

test("detached process reaches unchecked and completed", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-background-process-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const started = await startBackgroundProcess({
    taskRoot: root,
    ownerSessionId: "session",
    cwd: root,
    label: "echo",
    spec: { type: "shell", command: "printf 'hello'" },
  });
  assert.ok(
    started.phase === "pending" || started.phase === "running" || started.phase === "unchecked",
  );
  const finished = await waitForPhase(started.taskDir, "unchecked");
  assert.equal(finished.result?.outcome, "success");
  assert.equal((await readProcessOutput(started.taskDir)).stdout, "hello");
  await acknowledgeProcess(started.taskDir);
  assert.equal((await inspectProcess(started.taskDir)).phase, "completed");
});

test("an abandoned launcher is reconciled as lost", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-background-process-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const taskDir = join(root, "lost-task");
  await mkdir(taskDir);
  await atomicWriteJson(join(taskDir, "request.json"), {
    version: 1,
    id: "lost-task",
    label: "lost",
    kind: "command",
    ownerSessionId: "session",
    cwd: root,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    spec: { type: "shell", command: "true" },
  });
  await atomicWriteJson(join(taskDir, "launcher.json"), {
    pid: 999_999_999,
    launchedAt: new Date(Date.now() - 60_000).toISOString(),
  });
  const snapshot = await inspectProcess(taskDir);
  assert.equal(snapshot.phase, "unchecked");
  assert.equal(snapshot.result?.outcome, "lost");
});

test("a missing request is reconciled as a lost inspection", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-background-process-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const taskDir = join(root, "missing-request");
  await mkdir(taskDir);

  const snapshot = await inspectProcess(taskDir);
  assert.ok(!("request" in snapshot));
  if ("request" in snapshot) return;
  assert.equal(snapshot.phase, "unchecked");
  assert.equal(snapshot.result?.outcome, "lost");
  assert.equal(snapshot.error.code, "missing_request");
  assert.match(snapshot.result?.error ?? "", /request is missing/);

  const completedDir = join(root, "completed-without-request");
  await mkdir(completedDir);
  await atomicWriteJson(join(completedDir, "result.json"), {
    outcome: "success",
    finishedAt: new Date().toISOString(),
    exitCode: 0,
    signal: null,
  });
  await atomicWriteJson(join(completedDir, "acknowledged.json"), {
    acknowledgedAt: new Date().toISOString(),
  });
  const completed = await inspectProcess(completedDir);
  assert.ok(!("request" in completed));
  if ("request" in completed) return;
  assert.equal(completed.phase, "completed");
  assert.equal(completed.result?.outcome, "success");

  const repeated = await inspectProcess(taskDir);
  assert.ok(!("request" in repeated));
  if ("request" in repeated) return;
  assert.equal(repeated.result?.outcome, "lost");
});

test("list reports damaged process inspections instead of hiding them", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-background-process-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const missingDir = join(root, "missing-request");
  const invalidDir = join(root, "invalid-request");
  await mkdir(missingDir);
  await mkdir(invalidDir);
  await writeFile(join(invalidDir, "request.json"), "{", "utf8");

  const snapshots = await listProcesses(root);
  assert.equal(snapshots.length, 2);
  const missing = snapshots.find((snapshot) => snapshot.taskDir === missingDir);
  const invalid = snapshots.find((snapshot) => snapshot.taskDir === invalidDir);
  assert.ok(missing && !("request" in missing));
  assert.ok(invalid && !("request" in invalid));
  if (!missing || !invalid || "request" in missing || "request" in invalid) return;
  assert.equal(missing.error.code, "missing_request");
  assert.equal(invalid.error.code, "invalid_request");
});

test("inspection preserves ENOTDIR instead of reporting a missing directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-background-process-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "not-a-directory");
  await writeFile(file, "file", "utf8");

  await assert.rejects(
    () => inspectProcess(join(file, "task")),
    (error: NodeJS.ErrnoException) => error.code === "ENOTDIR",
  );
});

test("failed and stopped outcomes remain in the four-phase model", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-background-process-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const failed = await startBackgroundProcess({
    taskRoot: root,
    ownerSessionId: "session",
    cwd: root,
    spec: { type: "shell", command: "exit 7" },
  });
  assert.equal((await waitForPhase(failed.taskDir, "unchecked")).result?.outcome, "failed");

  const running = await startBackgroundProcess({
    taskRoot: root,
    ownerSessionId: "session",
    cwd: root,
    spec: { type: "shell", command: "sleep 30" },
  });
  await waitForPhase(running.taskDir, "running");
  await requestProcessStop(running.taskDir);
  assert.equal((await waitForPhase(running.taskDir, "unchecked")).result?.outcome, "stopped");
});

test("logs retain a bounded tail", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-background-process-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const started = await startBackgroundProcess({
    taskRoot: root,
    ownerSessionId: "session",
    cwd: root,
    spec: { type: "shell", command: "yes 0123456789 | head -n 120000" },
  });
  await waitForPhase(started.taskDir, "unchecked");
  const output = await readProcessOutput(started.taskDir);
  assert.ok(Buffer.byteLength(output.stdout) <= 1024 * 1024);
  assert.match(output.stdout, /earlier output truncated/);
});
