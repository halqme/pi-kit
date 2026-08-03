import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export interface HerdrResponse {
  id?: string;
  result?: Record<string, unknown>;
  error?: { code?: string; message?: string };
  [key: string]: unknown;
}

export interface HerdrCommandOptions {
  cwd?: string | undefined;
  signal?: AbortSignal | undefined;
  autoStart?: boolean | undefined;
}

export interface HerdrCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type HerdrCommandRunner = (
  executable: string,
  args: string[],
  options: Pick<HerdrCommandOptions, "cwd" | "signal">,
) => Promise<HerdrCommandResult>;

export type HerdrServerStarter = (executable: string) => Promise<void>;

export class HerdrCliError extends Error {
  readonly code: string | undefined;
  readonly args: string[];
  readonly stderr: string;

  constructor(message: string, args: string[], stderr = "", code?: string) {
    super(message);
    this.name = "HerdrCliError";
    this.args = args;
    this.stderr = stderr;
    this.code = code;
  }
}

export class HerdrCli {
  private serverStartPromise: Promise<void> | undefined;

  constructor(
    private readonly executable = "herdr",
    private readonly runCommand: HerdrCommandRunner = runHerdrCommand,
    private readonly startServer: HerdrServerStarter = startHerdrServer,
  ) {}

  async json(args: string[], options: HerdrCommandOptions = {}): Promise<HerdrResponse> {
    const result = await this.runWithServer(args, options);
    const response = parseJsonResponse(result.stdout || result.stderr, args);
    if (response.error) {
      throw new HerdrCliError(
        response.error.message ?? `Herdr command failed: ${args.join(" ")}`,
        args,
        result.stderr,
        response.error.code,
      );
    }
    return response;
  }

  async text(args: string[], options: HerdrCommandOptions = {}): Promise<string> {
    const result = await this.runWithServer(args, options);
    return result.stdout.trimEnd();
  }

  private async runWithServer(
    args: string[],
    options: HerdrCommandOptions,
  ): Promise<HerdrCommandResult> {
    const result = await this.runCommand(this.executable, args, options);
    if (result.exitCode === 0) return result;

    if ((options.autoStart ?? true) && isServerNotRunning(result)) {
      await this.ensureServer(options.signal);
      const retry = await this.runCommand(this.executable, args, options);
      if (retry.exitCode === 0) return retry;
      throw commandError(args, retry);
    }

    throw commandError(args, result);
  }

  private async ensureServer(signal?: AbortSignal): Promise<void> {
    if (!this.serverStartPromise) {
      this.serverStartPromise = (async () => {
        await this.startServer(this.executable);
        await this.waitUntilReady(signal);
      })();
      void this.serverStartPromise.then(
        () => {
          this.serverStartPromise = undefined;
        },
        () => {
          this.serverStartPromise = undefined;
        },
      );
    }
    await this.serverStartPromise;
  }

  private async waitUntilReady(signal?: AbortSignal): Promise<void> {
    const probeArgs = ["agent", "list"];
    let last: HerdrCommandResult | undefined;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (signal?.aborted) throw new Error("Herdr startup was aborted");
      last = await this.runCommand(this.executable, probeArgs, { signal });
      if (last.exitCode === 0) return;
      if (!isServerNotRunning(last)) throw commandError(probeArgs, last);
      await delay(100, undefined, { signal });
    }
    throw commandError(probeArgs, last ?? { exitCode: 1, stdout: "", stderr: "" });
  }
}

export function isServerNotRunning(result: HerdrCommandResult): boolean {
  const body = `${result.stdout}\n${result.stderr}`;
  if (body.includes('"code":"server_not_running"')) return true;
  if (body.includes('"code": "server_not_running"')) return true;
  return /no herdr server is running/i.test(body);
}

function parseJsonResponse(text: string, args: string[]): HerdrResponse {
  const value = text.trim();
  if (!value) throw new HerdrCliError("Herdr returned no JSON response", args);
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) throw new Error("response is not an object");
    return parsed as HerdrResponse;
  } catch (error) {
    throw new HerdrCliError(
      `Could not parse Herdr response for '${args.join(" ")}': ${String(error)}`,
      args,
      value,
    );
  }
}

function commandError(args: string[], result: HerdrCommandResult): HerdrCliError {
  const response = tryParseJson(result.stderr) ?? tryParseJson(result.stdout);
  const error = isRecord(response?.error) ? response.error : undefined;
  const code = typeof error?.code === "string" ? error.code : undefined;
  const message =
    (typeof error?.message === "string" && error.message) ||
    result.stderr.trim() ||
    result.stdout.trim() ||
    `Herdr exited with status ${result.exitCode}`;
  return new HerdrCliError(message, args, result.stderr, code);
}

function tryParseJson(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text.trim());
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function runHerdrCommand(
  executable: string,
  args: string[],
  options: Pick<HerdrCommandOptions, "cwd" | "signal">,
): Promise<HerdrCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.on("data", (chunk: string) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}

export function startHerdrServer(executable: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["server"], {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
