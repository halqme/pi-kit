import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { BrowserCommand, BrowserHost, HostResponse } from "./protocol.ts";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

function responseError(response: Extract<HostResponse, { ok: false }>): Error {
  const error = new Error(response.error.message);
  if (response.error.code) error.name = response.error.code;
  return error;
}

export class BrowserHostClient implements BrowserHost {
  private child: ChildProcessWithoutNullStreams | undefined;
  private lines: Interface | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private stderrTail = "";
  private starting: Promise<void> | undefined;

  private async start(): Promise<void> {
    if (this.child) return;
    if (this.starting) return this.starting;
    this.starting = new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.env.PI_KIT_BUN_PATH ?? "bun",
        [fileURLToPath(new URL("./host.ts", import.meta.url))],
        {
          stdio: "pipe",
          windowsHide: true,
        },
      );
      const onError = (error: Error): void => {
        child.off("spawn", onSpawn);
        this.child = undefined;
        reject(
          new Error(
            `browser_inspector could not start its Bun host: ${error.message}. Install Bun or set PI_KIT_BUN_PATH.`,
          ),
        );
      };
      const onSpawn = (): void => {
        child.off("error", onError);
        this.child = child;
        this.lines = createInterface({ input: child.stdout });
        this.lines.on("line", (line) => this.onLine(line));
        child.stderr.on("data", (chunk: Buffer) => {
          this.stderrTail = `${this.stderrTail}${chunk.toString("utf8")}`.slice(-4_096);
        });
        child.on("error", (error) => this.failAll(error));
        child.once("exit", (code, signal) => {
          const suffix = this.stderrTail.trim() ? `: ${this.stderrTail.trim()}` : "";
          this.failAll(
            new Error(
              `browser_inspector Bun host exited (${code ?? signal ?? "unknown"})${suffix}`,
            ),
          );
          this.lines?.close();
          this.lines = undefined;
          this.child = undefined;
        });
        resolve();
      };
      child.once("error", onError);
      child.once("spawn", onSpawn);
    }).finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private onLine(line: string): void {
    let response: HostResponse;
    try {
      response = JSON.parse(line) as HostResponse;
    } catch {
      this.failAll(
        new Error(`browser_inspector host returned invalid JSON: ${line.slice(0, 200)}`),
      );
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(responseError(response));
  }

  private failAll(error: Error): void {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  async request(command: BrowserCommand): Promise<unknown> {
    await this.start();
    const child = this.child;
    if (!child) throw new Error("browser_inspector Bun host is unavailable");
    const id = this.nextId++;
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    child.stdin.write(`${JSON.stringify({ id, command })}\n`, (error) => {
      if (!error) return;
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      pending.reject(error);
    });
    return result;
  }

  async dispose(): Promise<void> {
    const child = this.child;
    this.lines?.close();
    this.lines = undefined;
    this.child = undefined;
    if (!child) return;
    this.failAll(new Error("browser_inspector host disposed"));
    child.kill();
  }
}
