import { resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  acknowledgeProcess,
  inspectProcess,
  listProcesses,
  readProcessOutput,
  requestProcessStop,
  startBackgroundProcess,
  taskPath,
  type ProcessSnapshot,
} from "./core.ts";

const TOOL_NAME = "background_process";
const POLL_MS = 2_000;

function rootFor(ctx: ExtensionContext): string {
  return `${ctx.sessionManager.getSessionDir()}/${ctx.sessionManager.getSessionId()}.background-process`;
}

function describe(snapshot: ProcessSnapshot): string {
  const result = snapshot.result ? `/${snapshot.result.outcome}` : "";
  return `${snapshot.request.id} [${snapshot.phase}${result}] ${snapshot.request.label}`;
}

function formatList(snapshots: ProcessSnapshot[]): string {
  return snapshots.length === 0 ? "No background processes." : snapshots.map(describe).join("\n");
}

export default function backgroundProcessExtension(pi: ExtensionAPI): void {
  let timer: NodeJS.Timeout | undefined;
  let activeContext: ExtensionContext | undefined;
  const announced = new Map<string, string>();

  function updateStatus(ctx: ExtensionContext, snapshots: ProcessSnapshot[]): void {
    const running = snapshots.filter((item) => item.phase === "running").length;
    const pending = snapshots.filter((item) => item.phase === "pending").length;
    const unchecked = snapshots.filter((item) => item.phase === "unchecked").length;
    const text = [
      running && `${running} running`,
      pending && `${pending} pending`,
      unchecked && `${unchecked} unchecked`,
    ]
      .filter(Boolean)
      .join(", ");
    ctx.ui.setStatus("background-process", text ? `bg: ${text}` : undefined);
  }

  async function announce(
    ctx: ExtensionContext,
    snapshot: ProcessSnapshot,
    force: boolean,
  ): Promise<void> {
    const previous = announced.get(snapshot.request.id);
    if (!force && previous === snapshot.phase) return;
    announced.set(snapshot.request.id, snapshot.phase);
    const text = `[background-process] ${describe(snapshot)}`;
    pi.sendMessage(
      {
        customType: "background-process-status",
        content: text,
        display: true,
        details: snapshot,
      },
      snapshot.phase === "unchecked"
        ? { triggerTurn: ctx.isIdle(), deliverAs: ctx.isIdle() ? "nextTurn" : "followUp" }
        : { triggerTurn: false, deliverAs: "nextTurn" },
    );
    if (snapshot.phase === "unchecked") await acknowledgeProcess(snapshot.taskDir);
  }

  async function poll(ctx: ExtensionContext, force = false): Promise<void> {
    const snapshots = await listProcesses(rootFor(ctx));
    updateStatus(ctx, snapshots);
    for (const snapshot of snapshots) await announce(ctx, snapshot, force);
  }

  pi.registerTool({
    name: TOOL_NAME,
    label: "Background Process",
    description:
      "Start one or more durable background shell commands, list, check, or stop them. Use for dev servers, watchers, builds, tests, and other commands that should outlive the current turn. Completed processes are hidden unless explicitly requested.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("start"),
        Type.Literal("start_many"),
        Type.Literal("list"),
        Type.Literal("check"),
        Type.Literal("stop"),
      ]),
      command: Type.Optional(Type.String({ description: "Shell command for start" })),
      processes: Type.Optional(
        Type.Array(
          Type.Object({
            command: Type.String({ description: "Shell command" }),
            cwd: Type.Optional(Type.String({ description: "Working directory" })),
            label: Type.Optional(Type.String({ description: "Short process label" })),
          }),
          { description: "Commands for start_many" },
        ),
      ),
      cwd: Type.Optional(Type.String({ description: "Working directory for start" })),
      label: Type.Optional(Type.String({ description: "Short process label" })),
      id: Type.Optional(Type.String({ description: "Process ID for check or stop" })),
      includeCompleted: Type.Optional(Type.Boolean({ default: false })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.sessionManager.getSessionFile()) {
        return {
          content: [
            { type: "text" as const, text: "background-process requires a persistent session." },
          ],
          details: {},
          isError: true,
        };
      }
      const root = rootFor(ctx);
      try {
        if (params.action === "start") {
          if (!params.command?.trim()) throw new Error("command is required for start");
          const snapshot = await startBackgroundProcess({
            taskRoot: root,
            ownerSessionId: ctx.sessionManager.getSessionId(),
            cwd: resolve(ctx.cwd, params.cwd ?? "."),
            spec: { type: "shell", command: params.command },
            ...(params.label ? { label: params.label } : {}),
          });
          announced.set(snapshot.request.id, snapshot.phase);
          await poll(ctx);
          return {
            content: [{ type: "text" as const, text: `Started ${describe(snapshot)}` }],
            details: snapshot,
          };
        }
        if (params.action === "start_many") {
          const processes = params.processes;
          if (!processes?.length) throw new Error("processes is required and must not be empty");
          if (processes.some((process) => !process.command.trim())) {
            throw new Error("every process command is required");
          }
          const results = await Promise.allSettled(
            processes.map((process) =>
              startBackgroundProcess({
                taskRoot: root,
                ownerSessionId: ctx.sessionManager.getSessionId(),
                cwd: resolve(ctx.cwd, process.cwd ?? "."),
                spec: { type: "shell", command: process.command },
                ...(process.label ? { label: process.label } : {}),
              }),
            ),
          );
          const started = results.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : [],
          );
          const failed = results.flatMap((result, index) =>
            result.status === "rejected" ? [{ index, error: String(result.reason) }] : [],
          );
          for (const snapshot of started) announced.set(snapshot.request.id, snapshot.phase);
          await poll(ctx);
          const text = [
            started.length
              ? `Started ${started.length} process(es):\n${started.map(describe).join("\n")}`
              : "No processes started.",
            failed.length
              ? `Failed ${failed.length} process(es):\n${failed.map((item) => `${item.index}: ${item.error}`).join("\n")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n\n");
          return {
            content: [{ type: "text" as const, text }],
            details: { started, failed },
            ...(failed.length ? { isError: true } : {}),
          };
        }
        if (params.action === "list") {
          const snapshots = await listProcesses(root, {
            includeCompleted: params.includeCompleted ?? false,
          });
          return {
            content: [{ type: "text" as const, text: formatList(snapshots) }],
            details: snapshots,
          };
        }
        if (!params.id) throw new Error(`id is required for ${params.action}`);
        const dir = taskPath(root, params.id);
        if (params.action === "stop") {
          const snapshot = await requestProcessStop(dir);
          return {
            content: [{ type: "text" as const, text: `Stop requested: ${describe(snapshot)}` }],
            details: snapshot,
          };
        }
        const snapshot = await inspectProcess(dir);
        const output = await readProcessOutput(dir);
        if (snapshot.phase === "unchecked") await acknowledgeProcess(dir);
        return {
          content: [
            {
              type: "text" as const,
              text: `${describe(snapshot)}\n\nstdout:\n${output.stdout || "(empty)"}\n\nstderr:\n${output.stderr || "(empty)"}`,
            },
          ],
          details: { snapshot, output },
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: String(error) }],
          details: {},
          isError: true,
        };
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    activeContext = ctx;
    announced.clear();
    if (timer) clearInterval(timer);
    await poll(ctx, true);
    timer = setInterval(() => {
      if (activeContext) void poll(activeContext).catch(() => undefined);
    }, POLL_MS);
    timer.unref();
  });
  pi.on("session_compact", async (_event, ctx) => poll(ctx, true));
  pi.on("session_shutdown", (_event, ctx) => {
    if (timer) clearInterval(timer);
    timer = undefined;
    activeContext = undefined;
    ctx.ui.setStatus("background-process", undefined);
  });
}
