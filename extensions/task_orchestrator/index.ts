import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TerminalSessionService } from "../terminal/service.ts";
import {
  buildQueenPrompt,
  TaskRuntime,
  TaskStore,
  type QueenManager,
  type Task,
} from "./core.ts";
import { GitWorktreeManager } from "./git.ts";

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: value,
  };
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

class TerminalQueenManager implements QueenManager {
  constructor(private readonly terminals = new TerminalSessionService()) {}

  async launch(task: Task, mode: "start" | "resume"): Promise<string> {
    const name = `queen-${task.id}-${randomUUID().slice(0, 6)}`;
    const command = `pi --name ${shellQuote(name)} ${shellQuote(buildQueenPrompt(task, mode))}`;
    return (await this.terminals.create(command, task.worktreePath)).session;
  }

  isAlive(session: string): Promise<boolean> {
    return this.terminals.isAlive(session);
  }

  close(session: string): Promise<void> {
    return this.terminals.close(session);
  }
}

export default function taskOrchestratorExtension(pi: ExtensionAPI): void {
  const agentDir = getAgentDir();
  const runtime = new TaskRuntime(
    new TaskStore(join(agentDir, "task-runtime", "tasks")),
    new GitWorktreeManager(pi),
    new TerminalQueenManager(),
    join(agentDir, "worktrees"),
  );

  pi.registerTool({
    name: "task_orchestrator",
    label: "Task Runtime",
    description:
      "Create and supervise durable implementation tasks in dedicated Git worktrees. Use submit from the front session to hand substantial repository work to a task-owned Queen; use status/list to inspect tasks, resume after a stopped Queen, complete only from the Queen's own worktree after verification, and cleanup only when the retained worktree is clean. This MVP does not merge/apply task branches, create workers, reconcile conflicts, or recover tasks automatically.",
    promptSnippet:
      "Submit and supervise durable repository tasks in isolated Git worktrees without doing the task planning or implementation in the front session.",
    promptGuidelines: [
      "For a durable implementation task in the front session, hand off the user's request with task_orchestrator.submit instead of planning or editing it in the front session.",
      "If you are the Queen for an existing task, do not submit another top-level task; work in the current task worktree and call complete only after verification.",
      "Do not run git worktree lifecycle commands for managed tasks; task_orchestrator owns creation and cleanup, and cleanup intentionally refuses dirty worktrees.",
    ],
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("submit"),
        Type.Literal("status"),
        Type.Literal("list"),
        Type.Literal("resume"),
        Type.Literal("complete"),
        Type.Literal("cleanup"),
      ]),
      request: Type.Optional(
        Type.String({ description: "Complete user request to hand to the Queen. Required for submit." }),
      ),
      taskId: Type.Optional(
        Type.String({ description: "Task id. Required for status, resume, complete, and cleanup." }),
      ),
    }),
    async execute(_callId, params, _signal, _update, ctx) {
      if (params.action === "submit") {
        if (!params.request?.trim()) throw new Error("request is required for submit");
        return result(await runtime.submit(params.request, ctx.cwd));
      }
      if (params.action === "list") return result(await runtime.list());
      if (!params.taskId?.trim()) throw new Error(`taskId is required for ${params.action}`);
      if (params.action === "status") return result(await runtime.status(params.taskId));
      if (params.action === "resume") return result(await runtime.resume(params.taskId));
      if (params.action === "complete")
        return result(await runtime.complete(params.taskId, ctx.cwd));
      if (params.action === "cleanup") return result(await runtime.cleanup(params.taskId));
      throw new Error("Unsupported task_orchestrator action");
    },
  });
}
