import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const exec = promisify(execFile);
const TERMINAL_ENTRY = "terminal:session";
const TERMINAL_CLOSED_ENTRY = "terminal:closed";
type RecordValue = Record<string, unknown>;
type Terminal = { name: string; paneId: string; workspaceId: string; cwd: string };
const terminals = new Map<string, Terminal>();
const watches = new Map<string, { name: string; pattern: string; once: boolean; last: string }>();

async function herdr(args: string[], cwd?: string): Promise<RecordValue> {
  const { stdout, stderr } = await exec("herdr", args, { cwd });
  const text = (stdout || stderr).trim();
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Herdr returned an invalid response");
  }
  return parsed as RecordValue;
}

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: value,
  };
}

function restoreTerminals(ctx: ExtensionContext): void {
  terminals.clear();
  for (const entry of ctx.sessionManager.getEntries()) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as { type?: unknown; customType?: unknown; data?: unknown };
    if (value.type !== "custom" || !value.data || typeof value.data !== "object") continue;
    const data = value.data as RecordValue;
    const name = typeof data.name === "string" ? data.name : undefined;
    if (!name) continue;
    if (value.customType === TERMINAL_CLOSED_ENTRY) {
      terminals.delete(name);
      continue;
    }
    if (
      value.customType === TERMINAL_ENTRY &&
      typeof data.paneId === "string" &&
      typeof data.workspaceId === "string" &&
      typeof data.cwd === "string"
    ) {
      terminals.set(name, {
        name,
        paneId: data.paneId,
        workspaceId: data.workspaceId,
        cwd: data.cwd,
      });
    }
  }
}

export default function terminalExtension(pi: ExtensionAPI): void {
  let watcher: NodeJS.Timeout | undefined;
  let activeContext: ExtensionContext | undefined;

  const pollWatches = async (): Promise<void> => {
    if (!activeContext || watches.size === 0) return;
    for (const [watchId, watch] of watches) {
      const terminal = terminals.get(watch.name);
      if (!terminal) continue;
      try {
        const output = JSON.stringify(
          await herdr([
            "pane",
            "read",
            terminal.paneId,
            "--source",
            "recent-unwrapped",
            "--lines",
            "200",
          ]),
        );
        if (output.includes(watch.pattern) && output !== watch.last) {
          watch.last = output;
          pi.sendMessage(
            {
              customType: "terminal-watch",
              content: `[terminal ${watch.name}] ${watch.pattern}`,
              display: true,
              details: { watchId, output },
            },
            { triggerTurn: true, deliverAs: activeContext.isIdle() ? "nextTurn" : "followUp" },
          );
          if (watch.once) watches.delete(watchId);
        } else {
          watch.last = output;
        }
      } catch {
        // Keep watches alive across transient Herdr read failures.
      }
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    activeContext = ctx;
    restoreTerminals(ctx);
    watcher ??= setInterval(() => void pollWatches(), 2_000);
  });
  pi.on("session_shutdown", async () => {
    if (watcher) clearInterval(watcher);
    watcher = undefined;
  });

  pi.registerTool({
    name: "terminal",
    label: "Terminal",
    description:
      "Manage persistent Herdr TTY sessions for delegated agents. Use for SSH, REPLs, shells, and log streams that need later input or independent output watchers. All actions are asynchronous except read; do not use it for ordinary one-shot commands.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("create"),
        Type.Literal("list"),
        Type.Literal("send"),
        Type.Literal("read"),
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
      watchId: Type.Optional(Type.String()),
      once: Type.Optional(Type.Boolean()),
      paneId: Type.Optional(Type.String()),
    }),
    async execute(_callId, params, _signal, _update, ctx) {
      try {
        if (params.action === "create") {
          if (!params.name?.trim() || !params.command?.trim())
            throw new Error("name and command are required");
          if (terminals.has(params.name))
            throw new Error(`Terminal already exists: ${params.name}`);
          const created = await herdr([
            "workspace",
            "create",
            "--cwd",
            params.cwd ?? ctx.cwd,
            "--label",
            `terminal:${params.name}`,
            "--no-focus",
          ]);
          const data = (created.result ?? created) as RecordValue;
          const workspace = data.workspace as RecordValue | undefined;
          const pane = data.root_pane as RecordValue | undefined;
          const workspaceId = String(workspace?.workspace_id ?? workspace?.id ?? "");
          const paneId = String(pane?.pane_id ?? pane?.id ?? "");
          if (!workspaceId || !paneId) throw new Error("Herdr did not return a workspace or pane");
          await herdr(["pane", "run", paneId, "sh", "-lc", params.command]);
          const terminal = { name: params.name, paneId, workspaceId, cwd: params.cwd ?? ctx.cwd };
          terminals.set(params.name, terminal);
          pi.appendEntry(TERMINAL_ENTRY, terminal);
          return result({ status: "started", ...terminal });
        }
        if (params.action === "list") return result([...terminals.values()]);
        if (params.action === "cancel_watch") {
          if (!params.watchId) throw new Error("watchId is required");
          const removed = watches.delete(params.watchId);
          return result({ status: removed ? "cancelled" : "not_found", watchId: params.watchId });
        }
        if (!params.name?.trim()) throw new Error(`name is required for ${params.action}`);
        const terminal = terminals.get(params.name);
        if (!terminal) throw new Error(`Unknown terminal: ${params.name}`);
        if (params.action === "send") {
          if (params.text === undefined) throw new Error("text is required");
          await herdr(["pane", "send-text", terminal.paneId, params.text]);
          return result({ status: "accepted", name: terminal.name });
        }
        if (params.action === "read") {
          const output = await herdr([
            "pane",
            "read",
            terminal.paneId,
            "--source",
            "recent-unwrapped",
            "--lines",
            String(params.lines ?? 80),
          ]);
          return result(output);
        }
        if (params.action === "watch") {
          if (!params.pattern?.trim()) throw new Error("pattern is required");
          const watchId = crypto.randomUUID();
          watches.set(watchId, {
            name: terminal.name,
            pattern: params.pattern,
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
          await herdr(["workspace", "close", terminal.workspaceId]);
          terminals.delete(terminal.name);
          for (const [id, watch] of watches) if (watch.name === terminal.name) watches.delete(id);
          pi.appendEntry(TERMINAL_CLOSED_ENTRY, { name: terminal.name });
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
