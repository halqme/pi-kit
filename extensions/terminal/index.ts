import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const exec = promisify(execFile);
const SESSION_ENTRY = "terminal:session";
const CLOSED_ENTRY = "terminal:closed";
type Terminal = { name: string; session: string; cwd: string };
type Call = { id: string; name: string; start: string; end: string; command: string };
const terminals = new Map<string, Terminal>();
const calls = new Map<string, Call>();
const watches = new Map<
  string,
  { name: string; pattern: string; stream: "output" | "stderr"; once: boolean; last: string }
>();

async function tmux(args: string[]): Promise<string> {
  const { stdout, stderr } = await exec("tmux", args);
  return (stdout || stderr).trimEnd();
}

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: value,
  };
}

function restore(ctx: ExtensionContext): void {
  terminals.clear();
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
    }
  }
}

export default function terminalExtension(pi: ExtensionAPI): void {
  let activeContext: ExtensionContext | undefined;
  let timer: NodeJS.Timeout | undefined;

  const poll = async (): Promise<void> => {
    if (!activeContext) return;
    for (const [id, call] of calls) {
      const terminal = terminals.get(call.name);
      if (!terminal) continue;
      try {
        const output = await tmux(["capture-pane", "-p", "-J", "-t", terminal.session, "-S", "-"]);
        const start = output.indexOf(call.start);
        const end = output.indexOf(call.end, start + call.start.length);
        if (start < 0 || end < 0) continue;
        const body = output.slice(start + call.start.length, end).trim();
        const status = output.slice(end + call.end.length).match(/^(\d+)/)?.[1] ?? "unknown";
        pi.sendMessage(
          {
            customType: "terminal-call",
            content: `[terminal ${call.name}] call completed`,
            display: true,
            details: { callId: id, command: call.command, output: body, exitCode: Number(status) },
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
      if (!terminal) continue;
      try {
        const output = await tmux(["capture-pane", "-p", "-J", "-t", terminal.session, "-S", "-"]);
        if (output.includes(watch.pattern) && output !== watch.last) {
          watch.last = output;
          pi.sendMessage(
            {
              customType: "terminal-watch",
              content: `[terminal ${watch.name}] ${watch.pattern}`,
              display: true,
              details: { watchId: id, stream: watch.stream, output },
            },
            { triggerTurn: true, deliverAs: activeContext.isIdle() ? "nextTurn" : "followUp" },
          );
          if (watch.once) watches.delete(id);
        } else watch.last = output;
      } catch {
        // Keep watches alive across transient terminal failures.
      }
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    activeContext = ctx;
    restore(ctx);
    timer ??= setInterval(() => void poll(), 2_000);
  });
  pi.on("session_shutdown", async () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  });

  pi.registerTool({
    name: "terminal",
    label: "Terminal",
    description:
      "Manage persistent tmux terminals for Agents. Use send for interactive input, call for asynchronous command results, read for terminal state, and watch for output patterns. Sessions survive Pi reloads and restarts.",
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
      lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
      pattern: Type.Optional(Type.String()),
      stream: Type.Optional(Type.Union([Type.Literal("output"), Type.Literal("stderr")])),
      once: Type.Optional(Type.Boolean()),
      watchId: Type.Optional(Type.String()),
    }),
    async execute(_callId, params, _signal, _update, ctx) {
      try {
        if (params.action === "list") return result([...terminals.values()]);
        if (params.action === "create") {
          if (!params.name?.trim() || !params.command?.trim())
            throw new Error("name and command are required");
          if (terminals.has(params.name))
            throw new Error(`Terminal already exists: ${params.name}`);
          const session = `pi-terminal-${randomUUID()}`;
          await tmux(["new-session", "-d", "-s", session, "-c", params.cwd ?? ctx.cwd]);
          await tmux(["send-keys", "-t", session, "-l", params.command]);
          await tmux(["send-keys", "-t", session, "Enter"]);
          const terminal = { name: params.name, session, cwd: params.cwd ?? ctx.cwd };
          terminals.set(params.name, terminal);
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
          if (params.text === undefined) throw new Error("text is required");
          await tmux(["send-keys", "-t", terminal.session, "-l", params.text]);
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
          const id = randomUUID();
          const start = `__PI_CALL_${id}_START__`;
          const end = `__PI_CALL_${id}_END__`;
          calls.set(id, { id, name: terminal.name, start, end, command: params.command });
          const wrapped = `printf '${start}\\n'; ${params.command}; printf '${end}%s\\n' "$?"`;
          await tmux(["send-keys", "-t", terminal.session, "-l", wrapped]);
          await tmux(["send-keys", "-t", terminal.session, "Enter"]);
          return result({ status: "accepted", callId: id, name: terminal.name });
        }
        if (params.action === "watch") {
          if (!params.pattern?.trim()) throw new Error("pattern is required");
          const watchId = randomUUID();
          watches.set(watchId, {
            name: terminal.name,
            pattern: params.pattern,
            stream: params.stream ?? "output",
            once: params.once ?? true,
            last: "",
          });
          return result({
            status: "watching",
            watchId,
            name: terminal.name,
            pattern: params.pattern,
          });
        }
        if (params.action === "close") {
          await tmux(["kill-session", "-t", terminal.session]);
          terminals.delete(terminal.name);
          for (const [id, watch] of watches) if (watch.name === terminal.name) watches.delete(id);
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
