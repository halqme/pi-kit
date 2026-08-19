import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const exec = promisify(execFile);
const SESSION_ENTRY = "terminal:session";
const CLOSED_ENTRY = "terminal:closed";
const RUNTIME_ENTRY = "terminal:runtime";
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
type Watch = {
  id: string;
  name: string;
  pattern: string;
  once: boolean;
  last: string;
};
type RuntimeSnapshot = { calls: Call[]; watches: Watch[] };
const terminals = new Map<string, Terminal>();
const health = new Map<string, Health>();
const calls = new Map<string, Call>();
const watches = new Map<string, Watch>();

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

function runtimeSnapshot(): RuntimeSnapshot {
  return {
    calls: [...calls.values()].map((call) => ({ ...call })),
    watches: [...watches.values()].map((watch) => ({ ...watch })),
  };
}

function persistRuntime(pi: ExtensionAPI): void {
  pi.appendEntry(RUNTIME_ENTRY, runtimeSnapshot());
}

function isCall(value: unknown): value is Call {
  if (!value || typeof value !== "object") return false;
  const call = value as Record<string, unknown>;
  return (
    typeof call.id === "string" &&
    typeof call.name === "string" &&
    typeof call.start === "string" &&
    typeof call.end === "string" &&
    typeof call.command === "string" &&
    typeof call.createdAt === "number" &&
    typeof call.timeoutMs === "number" &&
    typeof call.statusFile === "string" &&
    (call.state === "pending" || call.state === "notifying")
  );
}

function isWatch(value: unknown): value is Watch {
  if (!value || typeof value !== "object") return false;
  const watch = value as Record<string, unknown>;
  return (
    typeof watch.id === "string" &&
    typeof watch.name === "string" &&
    typeof watch.pattern === "string" &&
    typeof watch.once === "boolean" &&
    typeof watch.last === "string"
  );
}

function restore(ctx: ExtensionContext): void {
  terminals.clear();
  health.clear();
  calls.clear();
  watches.clear();
  let latestRuntime: RuntimeSnapshot | undefined;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as { type?: unknown; customType?: unknown; data?: unknown };
    if (value.type !== "custom" || !value.data || typeof value.data !== "object") continue;
    const data = value.data as Record<string, unknown>;
    if (value.customType === CLOSED_ENTRY && typeof data.name === "string") {
      terminals.delete(data.name);
      health.delete(data.name);
      continue;
    }
    if (
      value.customType === SESSION_ENTRY &&
      typeof data.name === "string" &&
      typeof data.session === "string" &&
      typeof data.cwd === "string"
    ) {
      terminals.set(data.name, { name: data.name, session: data.session, cwd: data.cwd });
      health.set(data.name, { status: "running", consecutiveFailures: 0, failureNotified: false });
      continue;
    }
    if (value.customType === RUNTIME_ENTRY) {
      const raw = value.data as { calls?: unknown; watches?: unknown };
      if (Array.isArray(raw.calls) && Array.isArray(raw.watches)) {
        latestRuntime = {
          calls: raw.calls.filter(isCall).map((call) => ({ ...call })),
          watches: raw.watches.filter(isWatch).map((watch) => ({ ...watch })),
        };
      }
    }
  }
  for (const call of latestRuntime?.calls ?? [])
    if (terminals.has(call.name) && call.state === "pending") calls.set(call.id, call);
  for (const watch of latestRuntime?.watches ?? [])
    if (terminals.has(watch.name)) watches.set(watch.id, watch);
}

export default function terminalExtension(pi: ExtensionAPI): void {
  let activeContext: ExtensionContext | undefined;
  let timer: NodeJS.Timeout | undefined;
  let polling = false;

  const poll = async (): Promise<void> => {
    if (polling || !activeContext) return;
    polling = true;
    let runtimeChanged = false;
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
              runtimeChanged = true;
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
              runtimeChanged = true;
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
          runtimeChanged = true;
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
          runtimeChanged = true;
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
            runtimeChanged = true;
            continue;
          }
          if (!appended) continue;
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
            runtimeChanged = true;
          }
        } catch {
          // Keep watches alive across transient terminal failures.
        }
      }
      if (runtimeChanged) persistRuntime(pi);
    } finally {
      polling = false;
    }
  };
  pollForTests = poll;

  pi.on("session_start", async (_event, ctx) => {
    activeContext = ctx;
    restore(ctx);
    await poll();
    timer ??= setInterval(() => void poll(), 2_000);
  });
  pi.on("session_shutdown", async () => {
    persistRuntime(pi);
    if (timer) clearInterval(timer);
    timer = undefined;
    pollForTests = undefined;
  });

  pi.registerTool({
    name: "terminal",
    label: "Terminal",
    description:
      "Manage persistent interactive tmux terminals. Use terminal when a process needs a TTY, later stdin or control keys, live state inspection, or output-pattern watches; for a dev server whose readiness gates the next step, use terminal with a readiness/failure watch. Use background_process for detached non-interactive processes whose stdout/stderr and process cancellation matter more than TTY interaction. Terminal registrations, pending calls, and watches are restored across Pi session reloads. call completion is asynchronous; timeoutMs stops tracking but does not interrupt the underlying command, and only one call may be pending per terminal.",
    promptGuidelines: [
      "Use background_process instead of terminal for non-interactive detached commands that do not need later stdin or TTY state.",
      "Use watch for actionable readiness, failure, or completion patterns instead of polling terminal.read repeatedly.",
      "Use terminal for dev servers when the next step depends on readiness or failure output; do not wait for process completion as a startup signal.",
      "Treat a watch match or call completion as process evidence only; verify semantic task completion separately.",
    ],
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
            Type.Literal("Tab"),
            Type.Literal("C-c"),
            Type.Literal("C-d"),
            Type.Literal("C-l"),
            Type.Literal("C-a"),
            Type.Literal("C-e"),
            Type.Literal("C-f"),
            Type.Literal("C-b"),
            Type.Literal("C-n"),
            Type.Literal("C-p"),
            Type.Literal("C-u"),
            Type.Literal("C-k"),
            Type.Literal("C-w"),
            Type.Literal("C-r"),
            Type.Literal("C-z"),
            Type.Literal("Escape"),
            Type.Literal("BSpace"),
            Type.Literal("Up"),
            Type.Literal("Down"),
            Type.Literal("Left"),
            Type.Literal("Right"),
            Type.Literal("Home"),
            Type.Literal("End"),
          ]),
        ),
      ),
      lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
      pattern: Type.Optional(Type.String()),
      once: Type.Optional(Type.Boolean()),
      watchId: Type.Optional(Type.String()),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1 })),
    }),
    renderCall(args, theme) {
      const detail =
        typeof args.command === "string"
          ? args.command
          : typeof args.pattern === "string"
            ? args.pattern
            : typeof args.text === "string"
              ? args.text
              : "";
      const preview = detail.length > 80 ? `${detail.slice(0, 77)}...` : detail;
      return new Text(
        `${theme.fg("toolTitle", theme.bold("terminal"))} ${theme.fg("accent", args.action)}${args.name ? ` ${theme.fg("accent", args.name)}` : ""}${preview ? ` ${theme.fg("dim", preview)}` : ""}`,
        0,
        0,
      );
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("warning", "Updating terminal..."), 0, 0);
      const content = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text ?? "")
        .join("\n");
      const details = result.details as unknown;
      let summary = content.split("\n")[0] || "Done";
      if (Array.isArray(details)) {
        summary = `${details.length} terminal(s)`;
      } else if (details && typeof details === "object") {
        const record = details as Record<string, unknown>;
        const name = typeof record.name === "string" ? record.name : undefined;
        const status = typeof record.status === "string" ? record.status : undefined;
        const output = typeof record.output === "string" ? record.output : undefined;
        if (name && output !== undefined) {
          const lines = output ? output.split("\n").length : 0;
          summary = `${name}: ${lines} output line(s)`;
        } else if (name && status) {
          summary = `${name}: ${status}`;
        } else if (status) {
          summary = status;
        }
      }
      if (context.isError) summary = content.split("\n")[0] || "Terminal failed";
      if (expanded) {
        summary += `\n\n${content}`;
        if (details !== undefined) summary += `\n\n${JSON.stringify(details, null, 2)}`;
      }
      return new Text(theme.fg(context.isError ? "error" : "toolOutput", summary), 0, 0);
    },
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
          const cancelled = watches.delete(params.watchId);
          if (cancelled) persistRuntime(pi);
          return result({
            status: cancelled ? "cancelled" : "not_found",
            watchId: params.watchId,
          });
        }
        if (!params.name?.trim()) throw new Error(`name is required for ${params.action}`);
        const terminal = terminals.get(params.name);
        if (!terminal)
          return result({
            status: "not_found",
            reason: "unknown_terminal",
            name: params.name,
            availableNames: [...terminals.keys()].sort(),
          });
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
          const pendingCall = [...calls.values()].find(
            (call) => call.name === terminal.name && call.state === "pending",
          );
          if (pendingCall)
            return result({
              status: "busy",
              reason: "pending_call",
              name: terminal.name,
              callId: pendingCall.id,
            });
          const id = randomUUID();
          const start = `__PI_CALL_${id}_START__`;
          const end = `__PI_CALL_${id}_END__`;
          const statusFile = `/tmp/pi-terminal-call-${id}.status`;
          const timeoutMs = params.timeoutMs ?? 300_000;
          const call: Call = {
            id,
            name: terminal.name,
            start,
            end,
            command: params.command,
            createdAt: runtime.now(),
            timeoutMs,
            statusFile,
            state: "pending",
          };
          calls.set(id, call);
          const wrapped = `rm -f '${statusFile}'; printf '${start}\\n'; ${params.command}; status=$?; printf '${end}%s\\n' "$status"; printf '%s\\n' "$status" > '${statusFile}'`;
          try {
            await tmux(["send-keys", "-t", terminal.session, "-l", wrapped]);
            await tmux(["send-keys", "-t", terminal.session, "Enter"]);
          } catch (error) {
            calls.delete(id);
            throw error;
          }
          persistRuntime(pi);
          return result({ status: "accepted", callId: id, name: terminal.name });
        }
        if (params.action === "watch") {
          if (!params.pattern?.trim()) throw new Error("pattern is required");
          const watchId = randomUUID();
          watches.set(watchId, {
            id: watchId,
            name: terminal.name,
            pattern: params.pattern,
            once: params.once ?? true,
            last: await tmux(["capture-pane", "-p", "-J", "-t", terminal.session, "-S", "-"]),
          });
          persistRuntime(pi);
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
          persistRuntime(pi);
          return result({ status: "accepted", name: terminal.name });
        }
        throw new Error("Unsupported terminal action");
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
      }
    },
  });

  const renderTerminalMessage = (
    message: { content: string | Array<{ type: string; text?: string }>; details?: unknown },
    expanded: boolean,
    theme: import("@earendil-works/pi-coding-agent").Theme,
  ) => {
    const body =
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((item) => item.type === "text")
            .map((item) => item.text ?? "")
            .join("\n");
    const details = message.details as Record<string, unknown> | undefined;
    let text = body;
    if (!expanded && details) {
      const exitCode = typeof details.exitCode === "number" ? ` (exit ${details.exitCode})` : "";
      text = `${body.split("\n")[0]}${exitCode}`;
    }
    if (expanded && details) text += `\n\n${JSON.stringify(details, null, 2)}`;
    return new Text(theme.fg("toolOutput", text), 0, 0);
  };

  pi.registerMessageRenderer?.("terminal-call", (message, { expanded }, theme) =>
    renderTerminalMessage(message, expanded, theme),
  );
  pi.registerMessageRenderer?.("terminal-watch", (message, { expanded }, theme) =>
    renderTerminalMessage(message, expanded, theme),
  );
}
