import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PiRpc } from "./rpc.ts";

const threads = new Map<string, { id: string; sessionFile: string; rpc: PiRpc }>();
const root = (ctx: ExtensionContext) => join(ctx.sessionManager.getSessionDir(), "threads");
const text = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "threads",
    label: "Threads",
    description:
      "Create and communicate with persistent Pi sessions. Humans can join them with /resume.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("create"),
        Type.Literal("send_message"),
        Type.Literal("wait"),
        Type.Literal("read"),
      ]),
      threadId: Type.Optional(Type.String()),
      message: Type.Optional(Type.String()),
      cwd: Type.Optional(Type.String()),
      timeoutMs: Type.Optional(Type.Number()),
      since: Type.Optional(Type.String()),
      model: Type.Optional(Type.String()),
    }),
    async execute(_callId, params, _signal, _update, ctx) {
      try {
        if (params.action === "create") {
          const id = randomUUID();
          const dir = root(ctx);
          await mkdir(dir, { recursive: true });
          const sessionFile = join(dir, `${id}.jsonl`);
          const args = params.model ? ["--model", params.model] : [];
          const rpc = new PiRpc(
            sessionFile,
            params.cwd ? resolve(ctx.cwd, params.cwd) : ctx.cwd,
            args,
          );
          threads.set(id, { id, sessionFile, rpc });
          if (params.message?.trim()) await rpc.prompt(params.message);
          return result({ id, sessionFile, status: params.message?.trim() ? "running" : "idle" });
        }
        if (!params.threadId) throw new Error("threadId is required");
        const thread = threads.get(params.threadId);
        if (!thread) throw new Error(`Unknown thread: ${params.threadId}`);
        if (params.action === "send_message") {
          if (!params.message?.trim()) throw new Error("message is required");
          await thread.rpc.prompt(params.message, "followUp");
          return result({ id: thread.id, status: "accepted" });
        }
        if (params.action === "wait") {
          await thread.rpc.wait(params.timeoutMs ?? 300_000);
          return result({ id: thread.id, status: "settled" });
        }
        const response = await thread.rpc.command(
          "get_entries",
          params.since ? { since: params.since } : {},
        );
        return result(response.data ?? response);
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: String(error) }],
          details: {},
          isError: true,
        };
      }
    },
  });

  pi.on("session_shutdown", async () => {
    await Promise.all([...threads.values()].map((thread) => thread.rpc.stop()));
  });
}

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: text(value) }], details: value };
}
