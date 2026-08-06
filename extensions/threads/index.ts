import { homedir } from "node:os";
import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PiRpc } from "./rpc.ts";
import { THREAD_ENTRY_TYPE, createThreadSession, recordedThreads } from "./session-store.ts";

const threads = new Map<string, { id: string; sessionFile: string; rpc: PiRpc }>();
const text = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "threads",
    label: "Threads",
    description:
      "Create, list, and communicate with persistent Pi sessions. list returns only sessions spawned by this extension, including their parent session.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("create"),
        Type.Literal("list"),
        Type.Literal("send_message"),
        Type.Literal("wait"),
        Type.Literal("read"),
      ]),
      threadId: Type.Optional(Type.String()),
      sessionId: Type.Optional(Type.String()),
      message: Type.Optional(Type.String()),
      cwd: Type.Optional(Type.String()),
      timeoutMs: Type.Optional(Type.Number()),
      since: Type.Optional(Type.String()),
      model: Type.Optional(Type.String()),
    }),
    async execute(_callId, params, _signal, _update, ctx) {
      try {
        const sessionDir = ctx.sessionManager.getSessionDir();
        if (params.action === "list")
          return result(recordedThreads(ctx.sessionManager.getEntries()));
        if (params.action === "create") {
          const id = randomUUID();
          const cwd = params.cwd ? resolve(ctx.cwd, params.cwd) : ctx.cwd;
          const spawned = createThreadSession(
            cwd,
            sessionDir,
            ctx.sessionManager.getSessionFile(),
            id,
          );
          pi.appendEntry(THREAD_ENTRY_TYPE, spawned);
          const rpc = new PiRpc(
            spawned.sessionFile,
            cwd,
            params.model ? ["--model", params.model] : [],
          );
          threads.set(id, { id, sessionFile: spawned.sessionFile, rpc });
          if (params.message?.trim()) await rpc.prompt(params.message);
          return result({
            ...spawned,
            resumeCommand: `pi --session ${spawned.sessionFile}`,
            status: params.message?.trim() ? "running" : "idle",
          });
        }
        const key = params.threadId ?? params.sessionId;
        if (!key) throw new Error("threadId or sessionId is required");
        const spawned =
          recordedThreads(ctx.sessionManager.getEntries()).find(
            (thread) => thread.id === key || thread.sessionId === key,
          ) ?? (await findSession(key));
        if (!spawned) throw new Error(`Unknown thread or session: ${key}`);
        let thread = threads.get(spawned.id);
        if (!thread) {
          const rpc = new PiRpc(
            spawned.sessionFile,
            spawned.cwd,
            params.model ? ["--model", params.model] : [],
          );
          thread = { id: spawned.id, sessionFile: spawned.sessionFile, rpc };
          threads.set(spawned.id, thread);
        }
        if (params.action === "send_message") {
          if (!params.message?.trim()) throw new Error("message is required");
          await thread.rpc.prompt(params.message, "followUp");
          return result({ id: thread.id, sessionId: spawned.sessionId, status: "accepted" });
        }
        if (params.action === "wait") {
          await thread.rpc.wait(params.timeoutMs ?? 300_000);
          return result({ id: thread.id, sessionId: spawned.sessionId, status: "settled" });
        }
        const response = await thread.rpc.command(
          "get_entries",
          params.since ? { since: params.since } : {},
        );
        return result(response.data ?? response);
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
      }
    },
  });
  pi.registerCommand("threads", {
    description: "List Pi sessions spawned by the current parent session",
    handler: async (_args, ctx) => {
      const spawned = recordedThreads(ctx.sessionManager.getEntries());
      ctx.ui.notify(
        spawned.length
          ? spawned.map((thread) => `${thread.id} ${thread.sessionFile}`).join("\n")
          : "No spawned Pi sessions for this parent session.",
        "info",
      );
    },
  });
  pi.on("session_shutdown", async () => {
    await Promise.all([...threads.values()].map((thread) => thread.rpc.stop()));
  });
}

async function findSession(sessionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return undefined;
  const root = resolve(homedir(), ".pi", "agent", "sessions");
  const sessionFile = await findFile(root, `_${sessionId}.jsonl`);
  if (!sessionFile) return undefined;
  let cwd = process.cwd();
  try {
    const firstLine = (await readFile(sessionFile, "utf8")).split("\n", 1)[0] ?? "";
    const header = JSON.parse(firstLine) as { cwd?: unknown };
    if (typeof header.cwd === "string") cwd = header.cwd;
  } catch {
    // The RPC process can still open the session with the current directory.
  }
  return {
    id: sessionId,
    sessionId,
    sessionFile,
    cwd,
    createdAt: "",
  };
}

async function findFile(directory: string, suffix: string): Promise<string | undefined> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isFile() && basename(path).endsWith(suffix)) return path;
    if (entry.isDirectory()) {
      const found = await findFile(path, suffix);
      if (found) return found;
    }
  }
  return undefined;
}

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: text(value) }], details: value };
}
