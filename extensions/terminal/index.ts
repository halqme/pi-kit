import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const exec = promisify(execFile);
const SESSION_ENTRY = "terminal:session";
const CLOSED_ENTRY = "terminal:closed";
type Terminal = { name: string; session: string; cwd: string };
type Health = {
  status: "running" | "suspect" | "dead";
  consecutiveFailures: number;
  failureNotified: boolean;
};
type Call = {
  id: string;
  name: string;
  start: string;
  end: string;
  command: string;
  createdAt: number;
  timeoutMs: number;
  statusFile: string;
  state: "pending" | "notifying";
};
const terminals = new Map<string, Terminal>();
const health = new Map<string, Health>();
const calls = new Map<string, Call>();
const watches = new Map<string, { name: string; pattern: string; once: boolean; last: string }>();

export type TerminalRuntime = {
  tmux(args: string[]): Promise<string>;
  now(): number;
  readFile(path: string): Promise<string>;
  unlink(path: string): Promise<void>;
};

const systemRuntime: TerminalRuntime = {
  async tmux(args) {
    const { stdout, stderr } = await exec("tmux", args);
    return (stdout || stderr).trimEnd();
  },
  now: () => Date.now(),
  readFile: (path) => readFile(path, "utf8"),
  unlink: (path) => unlink(path),
};
let runtime = systemRuntime;
let pollForTests: (() => Promise<void>) | undefined;

export function setTerminalRuntimeForTests(next: Partial<TerminalRuntime>): void {
  runtime = { ...systemRuntime, ...next };
}

export async function runTerminalPollForTests(): Promise<void> {
  await pollForTests?.();
}

async function tmux(args: string[]): Promise<string> {
  return runtime.tmux(args);
}

export function appendedWatchOutput(previous: string, current: string): string | undefined {
  if (!current.startsWith(previous)) return undefined;
  return current.slice(previous.length);
}

export function parseExitCode(status: string): number | null {
  return /^(?:0|[1-9]\d{0,2})$/.test(status) && Number(status) <= 255 ? Number(status) : null;
}

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: value,
  };
}

function restore(ctx: ExtensionContext): void {
  terminals.clear();
  health.clear();
  for (const entry of ctx.sessionManager.getEntries()) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as { type?: unknown; customType?: unknown; data?: unknown };
    if (value.type !== "custom" || !value.data || typeof value.data !== "object") continue;
    const data = value.data as Record<string, unknown>;
    if (typeof data.name !== "string") continue;
    if (value.customType === CLOSED_ENTRY) terminals.delete(data.name);
    if (
      value.customType === SESSION_ENTRY &&
      typeof data.session === "string" &&
      typeof data.cwd === "string"
    ) {
      terminals.set(data.name, { name: data.name, session: data.session, cwd: data.cwd });
      health.set(data.name, { status: "running", consecutiveFailures: 0, failureNotified: false });
    }
  }
}

export default function terminalExtension(pi: ExtensionAPI): void {
  let activeContext: ExtensionContext | undefined;
  let timer: NodeJS.Timeout | undefined;
  let polling = false;

  const poll = async (): Promise<void> => {
    if (polling || !activeContext) return;
    polling = true;
    try {
      for (const terminal of terminals.values()) {
        const state = health.get(terminal.name) ?? {
          status: "running",
          consecutiveFailures: 0,
          failureNotified: false,
        };
        try {
          await tmux(["has-session", "-t", terminal.session]);
          state.status = "running";
          state.consecutiveFailures = 0;
          state.failureNotified = false;
        } catch {
          state.status = "dead";
          state.consecutiveFailures++;
        }
        health.set(terminal.name, state);
        if (state.status === "dead" && !state.failureNotified) {
          state.failureNotified = true;
          for (const [id, call] of calls)
            if (call.name === terminal.name) {
              calls.delete(id);
              await unlink(call.statusFile).catch(() => {});
              pi.sendMessage(
                {
                  customType: "terminal-call",
                  content: `[terminal ${terminal.name}] call failed: session lost`,
                  display: true,
                  details: {
                    callId: id,
                    command: call.command,
                    status: "failed",
                    reason: "session_lost",
                  },
                },
                { triggerTurn: true, deliverAs: activeContext.isIdle() ? "nextTurn" : "followUp" },
              );
            }
          for (const [id, watch] of watches)
            if (watch.name === terminal.name) {
              watches.delete(id);
              pi.sendMessage(
                {
                  customType: "terminal-watch",
                  content: `[terminal ${terminal.name}] watch cancelled: session lost`,
                  display: true,
                  details: {
                    watchId: id,
                    pattern: watch.pattern,
                    status: "cancelled",
                    reason: "session_lost",
                  },
                },
                { triggerTurn: true, deliverAs: activeContext.isIdle() ? "nextTurn" : "followUp" },
              );
            }
        }
      }
      for (const [id, call] of calls) {
        if (runtime.now() - call.createdAt >= call.timeoutMs) {
          call.state = "notifying";
          await unlink(call.statusFile).catch(() => {});
          pi.sendMessage(
            {
              customType: "terminal-call",
              content: `[terminal ${call.name}] call timed out`,
              display: true,
              details: { callId: id, command: call.command, status: "failed", reason: "timeout" },
            },
            { triggerTurn: true, deliverAs: activeContext.isIdle() ? "nextTurn" : "followUp" },
          );
          calls.delete(id);
          continue;
        }
        const terminal = terminals.get(call.name);
        if (!terminal || health.get(call.name)?.status === "dead") continue;
        try {
          const output = await tmux([
            "capture-pane",
            "-p",
            "-J",
            "-t",
            terminal.session,
            "-S",
            "-",
          ]);
          const start = output.indexOf(call.start);
          const end = output.indexOf(call.end, start + call.start.length);
          const statusFromMarker =
            end >= 0 ? output.slice(end + call.end.length).match(/^(\d+)/)?.[1] : undefined;
          let status = statusFromMarker;
          if (!status) {
            try {
              status = (await runtime.readFile(call.statusFile)).trim();
            } catch {
              /* still running or status unavailable */
            }
          }
          if (!status) continue;
          const body =
            start >= 0 && end >= 0
              ? output.slice(start + call.start.length, end).trim()
              : "[output truncated: call markers are no longer in the tmux scrollback]";
          call.state = "notifying";
          await unlink(call.statusFile).catch(() => {});
          pi.sendMessage(
            {
              customType: "terminal-call",
              content: `[terminal ${call.name}] call completed`,
              display: true,
              details: {
                callId: id,
                command: call.command,
                output: body,
                exitCode: status ? parseExitCode(status) : null,
              },
            },
            { triggerTurn: true, deliverAs: activeContext.isIdle() ? "nextTurn" : "followUp" },
          );
          calls.delete(id);
        } catch {
          // Keep the call pending while the tmux session is temporarily unavailable.
        }
      }
      for (const [id, watch] of watches) {
        const terminal = terminals.get(watch.name);
        if (!terminal || health.get(watch.name)?.status === "dead") continue;
        try {
          const output = await tmux([
            "capture-pane",
            "-p",
            "-J",
            "-t",
            terminal.session,
            "-S",
            "-",
          ]);
          const appended = appendedWatchOutput(watch.last, output);
          if (appended === undefined) {
            watch.last = output;
            continue;
          }
          watch.last = output;
          if (appended.includes(watch.pattern)) {
            pi.sendMessage(
              {
                customType: "terminal-watch",
                content: `[terminal ${watch.name}] ${watch.pattern}`,
                display: true,
                details: { watchId: id, pattern: watch.pattern, matchedOutput: appended },
              },
              { triggerTurn: true, deliverAs: activeContext.isIdle() ? "nextTurn" : "followUp" },
            );
            if (watch.once) watches.delete(id);
          }
        } catch {
          // Keep watches alive across transient terminal failures.
        }
      }
    } finally {
      polling = false;
    }
  };
  pollForTests = poll;

  pi.on("session_start", async (_event, ctx) => {
    activeContext = ctx;
    calls.clear();
    watches.clear();
    restore(ctx);
    timer ??= setInterval(() => void poll(), 2_000);
  });
  pi.on("session_shutdown", async () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    pollForTests = undefined;
  });

  pi.registerTool({
    name: "terminal",
    label: "Terminal",
    description:
      "Manage persistent tmux terminals for Agents. Use terminal for interactive or long-lived TTY workflows; use background_process for one-shot commands or work requiring exact logs and process cancellation. send sends literal text, call reports completion asynchronously but timeoutMs only stops tracking and does not interrupt the command, and call allows only one pending call per terminal. list reports running/dead status and pending call/watch counts. Terminal registrations survive Pi reloads, but pending calls and watches belong to the Pi session and are not restored.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("create"),
        Type.Literal("list"),
        Type.Literal("send"),
        Type.Literal("read"),
        Type.Literal("call"),
        Type.Literal("watch"),
        Type.Literal("cancel_watch"),
        Type.Literal("close"),
      ]),
      name: Type.Optional(Type.String()),
      command: Type.Optional(Type.String()),
      cwd: Type.Optional(Type.String()),
      text: Type.Optional(Type.String()),
      keys: Type.Optional(
        Type.Array(
          Type.Union([
            Type.Literal("Enter"),
            Type.Literal("C-c"),
            Type.Literal("C-d"),
            Type.Literal("Escape"),
            Type.Literal("Up"),
            Type.Literal("Down"),
          ]),
        ),
      ),
      lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
      pattern: Type.Optional(Type.String()),
      once: Type.Optional(Type.Boolean()),
      watchId: Type.Optional(Type.String()),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    async execute(_callId, params, _signal, _update, ctx) {
      try {
        if (params.action === "list") {
          const listed = await Promise.all(
            [...terminals.values()].map(async (terminal) => {
              const state = health.get(terminal.name) ?? {
                status: "running",
                consecutiveFailures: 0,
                failureNotified: false,
              };
              try {
                await tmux(["has-session", "-t", terminal.session]);
                state.status = "running";
              } catch {
                state.status = "dead";
              }
              health.set(terminal.name, state);
              return {
                ...terminal,
                status: state.status,
                pendingCalls: [...calls.values()].filter((call) => call.name === terminal.name)
                  .length,
                watches: [...watches.values()].filter((watch) => watch.name === terminal.name)
                  .length,
              };
            }),
          );
          return result(listed);
        }
        if (params.action === "create") {
          if (!params.name?.trim() || !params.command?.trim())
            throw new Error("name and command are required");
          if (terminals.has(params.name))
            throw new Error(`Terminal already exists: ${params.name}`);
          const session = `pi-terminal-${randomUUID()}`;
          let sessionCreated = false;
          try {
            await tmux(["new-session", "-d", "-s", session, "-c", params.cwd ?? ctx.cwd]);
            sessionCreated = true;
            await tmux(["send-keys", "-t", session, "-l", params.command]);
            await tmux(["send-keys", "-t", session, "Enter"]);
          } catch (error) {
            if (sessionCreated) await tmux(["kill-session", "-t", session]).catch(() => {});
            throw error;
          }
          const terminal = { name: params.name, session, cwd: params.cwd ?? ctx.cwd };
          terminals.set(params.name, terminal);
          health.set(params.name, {
            status: "running",
            consecutiveFailures: 0,
            failureNotified: false,
          });
          pi.appendEntry(SESSION_ENTRY, terminal);
          return result({ status: "started", ...terminal });
        }
        if (params.action === "cancel_watch") {
          if (!params.watchId) throw new Error("watchId is required");
          return result({
            status: watches.delete(params.watchId) ? "cancelled" : "not_found",
            watchId: params.watchId,
          });
        }
        if (!params.name?.trim()) throw new Error(`name is required for ${params.action}`);
        const terminal = terminals.get(params.name);
        if (!terminal) throw new Error(`Unknown terminal: ${params.name}`);
        if (params.action === "send") {
          if (params.text === undefined && !params.keys?.length)
            throw new Error("text or keys is required");
          if (params.text !== undefined && params.keys?.length)
            throw new Error("text and keys are mutually exclusive");
          await tmux(
            params.text !== undefined
              ? ["send-keys", "-t", terminal.session, "-l", params.text]
              : ["send-keys", "-t", terminal.session, ...(params.keys ?? [])],
          );
          return result({ status: "accepted", name: terminal.name });
        }
        if (params.action === "read")
          return result({
            name: terminal.name,
            output: await tmux([
              "capture-pane",
              "-p",
              "-J",
              "-t",
              terminal.session,
              "-S",
              `-${params.lines ?? 80}`,
            ]),
          });
        if (params.action === "call") {
          if (!params.command?.trim()) throw new Error("command is required");
          if (
            [...calls.values()].some(
              (call) => call.name === terminal.name && call.state === "pending",
            )
          )
            throw new Error(`Terminal already has a pending call: ${terminal.name}`);
          const id = randomUUID();
          const start = `__PI_CALL_${id}_START__`;
          const end = `__PI_CALL_${id}_END__`;
          const statusFile = `/tmp/pi-terminal-call-${id}.status`;
          const timeoutMs = params.timeoutMs ?? 300_000;
          calls.set(id, {
            id,
            name: terminal.name,
            start,
            end,
            command: params.command,
            createdAt: runtime.now(),
            timeoutMs,
            statusFile,
            state: "pending",
          });
          const wrapped = `rm -f '${statusFile}'; printf '${start}\\n'; ${params.command}; status=$?; printf '${end}%s\\n' "$status"; printf '%s\\n' "$status" > '${statusFile}'`;
          try {
            await tmux(["send-keys", "-t", terminal.session, "-l", wrapped]);
            await tmux(["send-keys", "-t", terminal.session, "Enter"]);
          } catch (error) {
            calls.delete(id);
            throw error;
          }
          return result({ status: "accepted", callId: id, name: terminal.name });
        }
        if (params.action === "watch") {
          if (!params.pattern?.trim()) throw new Error("pattern is required");
          const watchId = randomUUID();
          watches.set(watchId, {
            name: terminal.name,
            pattern: params.pattern,
            once: params.once ?? true,
            last: await tmux(["capture-pane", "-p", "-J", "-t", terminal.session, "-S", "-"]),
          });
          return result({
            status: "watching",
            watchId,
            name: terminal.name,
            pattern: params.pattern,
          });
        }
        if (params.action === "close") {
          await tmux(["kill-session", "-t", terminal.session]).catch(() => {});
          terminals.delete(terminal.name);
          health.delete(terminal.name);
          for (const [id, call] of calls)
            if (call.name === terminal.name) {
              calls.delete(id);
              await unlink(call.statusFile).catch(() => {});
              pi.sendMessage(
                {
                  customType: "terminal-call",
                  content: `[terminal ${terminal.name}] call cancelled: terminal closed`,
                  display: true,
                  details: {
                    callId: id,
                    command: call.command,
                    status: "failed",
                    reason: "terminal_closed",
                  },
                },
                { triggerTurn: true, deliverAs: activeContext?.isIdle() ? "nextTurn" : "followUp" },
              );
            }
          for (const [id, watch] of watches)
            if (watch.name === terminal.name) {
              watches.delete(id);
              pi.sendMessage(
                {
                  customType: "terminal-watch",
                  content: `[terminal ${terminal.name}] watch cancelled: terminal closed`,
                  display: true,
                  details: {
                    watchId: id,
                    pattern: watch.pattern,
                    status: "cancelled",
                    reason: "terminal_closed",
                  },
                },
                { triggerTurn: true, deliverAs: activeContext?.isIdle() ? "nextTurn" : "followUp" },
              );
            }
          pi.appendEntry(CLOSED_ENTRY, { name: terminal.name });
          return result({ status: "accepted", name: terminal.name });
        }
        throw new Error("Unsupported terminal action");
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: String(error) }],
          details: {},
          isError: true,
        };
      }
    },
  });
}
