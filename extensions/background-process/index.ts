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
    const text = [
      `[background-process] ${describe(snapshot)}`,
      snapshot.phase === "unchecked"
        ? "Completion received. Continue the pending task; do not rerun check unless output is needed."
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    pi.sendMessage(
      {
        customType: "background-process-status",
        content: text,
        display: true,
        details: snapshot,
      },
      snapshot.phase === "unchecked"
        ? { triggerTurn: true, deliverAs: ctx.isIdle() ? "nextTurn" : "followUp" }
        : { triggerTurn: false, deliverAs: "nextTurn" },
    );
    if (snapshot.phase === "unchecked") await acknowledgeProcess(snapshot.taskDir);
  }

  async function poll(
    ctx: ExtensionContext,
    options: { force?: boolean; completedOnly?: boolean } = {},
  ): Promise<void> {
    const snapshots = await listProcesses(rootFor(ctx));
    updateStatus(ctx, snapshots);
    for (const snapshot of snapshots) {
      if (options.completedOnly && snapshot.phase !== "unchecked") continue;
      await announce(ctx, snapshot, options.force ?? false);
    }
  }

  pi.registerTool({
    name: TOOL_NAME,
    label: "Background Process",
    description:
      "Manage durable detached, non-interactive shell commands. Use for dev servers, watchers, builds, tests, batch jobs, and other commands that may outlive the current turn when later stdin, TTY state, control keys, and output-pattern watches are unnecessary; use terminal when those interactive capabilities are required. After starting a process, do not wait with sleep, polling, ps, or repeated check calls. Completion is delivered automatically, including after session resume. Completed processes are hidden unless explicitly requested.",
    promptGuidelines: [
      "Choose background_process by interaction model, not by expected duration: long-lived servers and watchers are valid when they do not need later TTY interaction.",
      "Use terminal instead when later stdin, control keys, interactive TTY state, or pattern watches are required.",
      "Use start or start_many for commands that may take longer than the current turn.",
      "After starting a background process, do not use sleep, polling, ps, or check to wait for completion.",
      "Report that the process started and end the turn; background-process will notify you when it completes.",
      "Use check only when the user explicitly asks for current progress or output.",
      "When a background-process completion message arrives, inspect its result and continue the pending task.",
    ],
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
            content: [
              {
                type: "text" as const,
                text: `Started ${describe(snapshot)}\nDo not wait or poll for completion; end this turn and let background-process notify you.`,
              },
            ],
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
            started.length
              ? "Do not wait or poll for completion; end this turn and let background-process notify you."
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
    await poll(ctx, { force: true, completedOnly: true });
    timer = setInterval(() => {
      if (activeContext) void poll(activeContext).catch(() => undefined);
    }, POLL_MS);
    timer.unref();
  });
  pi.on("session_compact", async (_event, ctx) => poll(ctx, { force: true, completedOnly: true }));
  pi.on("session_shutdown", (_event, ctx) => {
    if (timer) clearInterval(timer);
    timer = undefined;
    activeContext = undefined;
    ctx.ui.setStatus("background-process", undefined);
  });
}
