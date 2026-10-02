import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

export type OsaLanguage = "applescript" | "javascript";

export type OsaRunRequest = {
  language: OsaLanguage;
  script: string;
  timeoutMs: number;
  cwd: string;
  signal?: AbortSignal;
};

export type OsaRunResult = {
  ok: boolean;
  language: OsaLanguage;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
};

const LANGUAGE_NAME: Record<OsaLanguage, string> = {
  applescript: "AppleScript",
  javascript: "JavaScript",
};

export function parseJsonStdout(stdout: string): unknown | undefined {
  const text = stdout.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function normalizeTimeout(value: number | undefined): number {
  const timeoutMs = value ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    throw new Error("timeoutMs must be an integer between 100 and 120000");
  }
  return timeoutMs;
}

export async function runOsaProcess(request: OsaRunRequest): Promise<OsaRunResult> {
  const startedAt = performance.now();
  if (request.signal?.aborted) {
    return {
      ok: false,
      language: request.language,
      stdout: "",
      stderr: "",
      exitCode: null,
      durationMs: 0,
      timedOut: false,
      aborted: true,
    };
  }

  return await new Promise<OsaRunResult>((resolve, reject) => {
    const child = spawn("/usr/bin/osascript", ["-l", LANGUAGE_NAME[request.language]], {
      cwd: request.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let forceKillTimer: NodeJS.Timeout | undefined;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const terminate = (): void => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      forceKillTimer ??= setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }, 500);
      forceKillTimer.unref();
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, request.timeoutMs);
    timeout.unref();

    const abortHandler = (): void => {
      aborted = true;
      terminate();
    };
    request.signal?.addEventListener("abort", abortHandler, { once: true });

    const cleanup = (): void => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      request.signal?.removeEventListener("abort", abortHandler);
    };

    child.on("error", (error) => {
      cleanup();
      reject(error);
    });

    child.on("close", (code) => {
      cleanup();
      const result: OsaRunResult = {
        ok: code === 0 && !timedOut && !aborted,
        language: request.language,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
        exitCode: code,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        timedOut,
        aborted,
      };
      resolve(result);
    });

    child.stdin.on("error", () => {
      // osascript may exit before consuming stdin; close/error still carries the useful result.
    });
    child.stdin.end(request.script);
  });
}
