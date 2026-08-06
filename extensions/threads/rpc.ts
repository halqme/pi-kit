import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { basename, dirname } from "node:path";

export type RpcEvent = Record<string, unknown>;

type Pending = { resolve: (value: RpcEvent) => void; reject: (error: Error) => void };
type EventHandler = (event: RpcEvent) => void;

export class PiRpc {
  readonly child: ChildProcess;
  private buffer = "";
  private pending = new Map<string, Pending>();
  private events: RpcEvent[] = [];
  private settled = Promise.resolve();
  private resolveSettled = () => {};

  constructor(
    sessionFile: string,
    cwd: string,
    args: string[] = [],
    private readonly onEvent?: EventHandler,
  ) {
    const match = basename(sessionFile).match(/_([0-9a-f-]{36})\.jsonl$/);
    const sessionArgs = match?.[1]
      ? ["--session-id", match[1], "--session-dir", dirname(sessionFile)]
      : ["--session", sessionFile];
    this.child = spawn("pi", ["--mode", "rpc", ...sessionArgs, ...args], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.settled = new Promise((resolve) => (this.resolveSettled = resolve));
    this.child.stdout!.on("data", (chunk: Buffer) => this.onData(chunk.toString()));
    this.child.on("exit", () => {
      for (const pending of this.pending.values())
        pending.reject(new Error("Pi RPC process exited"));
      this.pending.clear();
      this.resolveSettled();
    });
  }

  private onData(data: string): void {
    this.buffer += data;
    let index;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).replace(/\r$/, "");
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let event: RpcEvent;
      try {
        event = JSON.parse(line) as RpcEvent;
      } catch {
        continue;
      }
      const id = typeof event.id === "string" ? event.id : undefined;
      if (id && this.pending.has(id)) {
        this.pending.get(id)!.resolve(event);
        this.pending.delete(id);
      } else {
        this.events.push(event);
        this.onEvent?.(event);
        if (event.type === "agent_settled") this.resolveSettled();
      }
    }
  }

  get isAlive(): boolean {
    return this.child.exitCode === null && !this.child.stdin?.destroyed;
  }

  command(type: string, fields: Record<string, unknown> = {}): Promise<RpcEvent> {
    if (!this.child.stdin || this.child.stdin.destroyed)
      return Promise.reject(new Error("Pi RPC stdin is closed"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin!.write(`${JSON.stringify({ id, type, ...fields })}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  async prompt(message: string, streamingBehavior?: "steer" | "followUp"): Promise<RpcEvent> {
    this.settled = new Promise((resolve) => (this.resolveSettled = resolve));
    return this.command("prompt", { message, ...(streamingBehavior ? { streamingBehavior } : {}) });
  }

  async wait(timeoutMs: number): Promise<void> {
    await Promise.race([
      this.settled,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`thread wait timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }

  async stop(): Promise<void> {
    if (!this.child.killed) this.child.kill("SIGTERM");
  }

  takeEvents(): RpcEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }
}
