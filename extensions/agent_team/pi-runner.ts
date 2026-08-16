import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  acknowledgeProcess,
  inspectProcess,
  readProcessOutput,
  requestProcessStop,
  startBackgroundProcess,
} from "@halqme/background_process";
import type { AgentTeamAgent, AgentTeamAgentFactory, AgentTeamMemberConfig } from "./team.ts";
import {
  validateAgentTeamThinking,
  validateAgentTeamTools,
  type AgentTeamThinkingLevel,
} from "./policy.ts";

const POLL_MS = 100;

export interface PiRunnerOptions {
  cwd: string;
  taskRoot: string;
  ownerSessionId: string;
  model?: string;
  tools: string[];
  thinking?: AgentTeamThinkingLevel;
  timeoutMs: number;
}

export function buildPiArgs(
  member: AgentTeamMemberConfig,
  options: Pick<PiRunnerOptions, "model" | "tools" | "thinking">,
): string[] {
  const args = ["-p", "--no-session"];
  const model = member.model?.trim() || options.model?.trim();
  if (model) args.push("--model", model);
  args.push("--thinking", validateAgentTeamThinking(options.thinking));
  const tools = validateAgentTeamTools(options.tools);
  if (tools.length > 0) args.push("--tools", tools.join(","));
  else args.push("--no-tools");
  args.push("--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes");
  for (const skill of member.skills ?? []) args.push("--skill", skill);
  return args;
}

const STOP_GRACE_MS = 5_000;

async function stopProcessAndWait(taskDir: string): Promise<void> {
  try {
    await requestProcessStop(taskDir);
  } catch {
    return;
  }
  const deadline = Date.now() + STOP_GRACE_MS;
  while (Date.now() < deadline) {
    try {
      const snapshot = await inspectProcess(taskDir);
      if (snapshot.phase === "unchecked" || snapshot.phase === "completed") {
        await acknowledgeProcess(taskDir);
        return;
      }
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export function createPiAgentFactory(options: PiRunnerOptions): AgentTeamAgentFactory {
  return async (member: AgentTeamMemberConfig, systemPrompt: string): Promise<AgentTeamAgent> => {
    const active = new Set<string>();
    const ask = async (prompt: string, signal?: AbortSignal): Promise<string> => {
      const args = buildPiArgs(member, options);
      await ensureAgentTeamTaskRoot(options.taskRoot);
      const task = await startBackgroundProcess({
        taskRoot: options.taskRoot,
        ownerSessionId: options.ownerSessionId,
        cwd: options.cwd,
        label: `agent-team/${member.name}`,
        kind: "agent-team-member",
        spec: { type: "argv", executable: "pi", args, stdin: `${systemPrompt}\n\n${prompt}\n` },
      });
      active.add(task.taskDir);
      try {
        const deadline = Date.now() + options.timeoutMs;
        while (Date.now() < deadline) {
          if (signal?.aborted) {
            await stopProcessAndWait(task.taskDir);
            throw new Error(`agent-team member '${member.name}' was aborted`);
          }
          const snapshot = await inspectProcess(task.taskDir);
          if (snapshot.phase === "unchecked" || snapshot.phase === "completed") {
            const output = await readProcessOutput(task.taskDir);
            await acknowledgeProcess(task.taskDir);
            if (snapshot.result?.outcome !== "success") {
              const reason = output.stderr || snapshot.result?.error || "Pi process failed";
              throw new Error(
                `agent-team member '${member.name}' ${snapshot.result?.outcome ?? "failed"}: ${reason}`,
              );
            }
            return output.stdout.trim();
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        await stopProcessAndWait(task.taskDir);
        throw new Error(
          `agent-team member '${member.name}' timed out after ${options.timeoutMs}ms`,
        );
      } finally {
        active.delete(task.taskDir);
      }
    };
    return {
      member,
      ask,
      stop: async () => {
        await Promise.allSettled([...active].map((taskDir) => stopProcessAndWait(taskDir)));
      },
    };
  };
}

export async function ensureAgentTeamTaskRoot(taskRoot: string): Promise<void> {
  await mkdir(taskRoot, { recursive: true });
}

export function agentTeamTaskRoot(sessionDir: string, sessionId: string): string {
  return join(sessionDir, "agent-team", sessionId);
}
