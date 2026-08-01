import { spawn } from "node:child_process";
import { appendFile, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const taskDir = process.argv[2];
if (!taskDir) process.exit(2);

const request = JSON.parse(await readFile(join(taskDir, "request.json"), "utf8"));
const LOG_LIMIT = 1024 * 1024;
const HEARTBEAT_MS = 2_000;
const STOP_POLL_MS = 500;

async function atomicWrite(name, value) {
  const target = join(taskDir, name);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function writeExclusive(name, value) {
  try {
    await writeFile(join(taskDir, name), `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
}

function createTailWriter(name) {
  const path = join(taskDir, name);
  let queue = Promise.resolve();
  return {
    write(chunk) {
      queue = queue.then(async () => {
        await appendFile(path, chunk);
        const details = await stat(path);
        if (details.size <= LOG_LIMIT) return;
        const keep = Math.floor(LOG_LIMIT * 0.8);
        const handle = await open(path, "r");
        const buffer = Buffer.alloc(keep);
        await handle.read(buffer, 0, keep, details.size - keep);
        await handle.close();
        await writeFile(path, Buffer.concat([Buffer.from("[earlier output truncated]\n"), buffer]));
      });
    },
    async flush() {
      await queue;
    },
  };
}

const stdout = createTailWriter("stdout.log");
const stderr = createTailWriter("stderr.log");
let stopped = false;
let child;
let heartbeat;
let stopPoll;
let forceKill;

try {
  const executable = request.spec.type === "shell" ? "/bin/sh" : request.spec.executable;
  const args = request.spec.type === "shell" ? ["-lc", request.spec.command] : request.spec.args;
  child = spawn(executable, args, {
    cwd: request.cwd,
    detached: true,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (request.spec.stdin !== undefined) {
    child.stdin.end(request.spec.stdin);
  } else {
    child.stdin.end();
  }
  child.stdout.on("data", (chunk) => stdout.write(chunk));
  child.stderr.on("data", (chunk) => stderr.write(chunk));

  await atomicWrite("running.json", {
    supervisorPid: process.pid,
    childPid: child.pid,
    startedAt: new Date().toISOString(),
  });
  const beat = () => atomicWrite("heartbeat.json", { updatedAt: new Date().toISOString() });
  await beat();
  heartbeat = setInterval(() => void beat(), HEARTBEAT_MS);

  stopPoll = setInterval(async () => {
    if (stopped) return;
    try {
      await stat(join(taskDir, "stop-requested.json"));
    } catch {
      return;
    }
    stopped = true;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
    forceKill = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }, 5_000);
  }, STOP_POLL_MS);

  const completed = await new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: null, signal: null, error: String(error) }));
    child.once("close", (code, signal) => resolve({ code, signal, error: undefined }));
  });
  await Promise.all([stdout.flush(), stderr.flush()]);
  await writeExclusive("result.json", {
    outcome: stopped ? "stopped" : completed.code === 0 ? "success" : "failed",
    finishedAt: new Date().toISOString(),
    exitCode: completed.code,
    signal: completed.signal,
    ...(completed.error ? { error: completed.error } : {}),
  });
} catch (error) {
  await writeExclusive("result.json", {
    outcome: stopped ? "stopped" : "failed",
    finishedAt: new Date().toISOString(),
    exitCode: null,
    signal: null,
    error: String(error),
  });
} finally {
  if (heartbeat) clearInterval(heartbeat);
  if (stopPoll) clearInterval(stopPoll);
  if (forceKill) clearTimeout(forceKill);
}
