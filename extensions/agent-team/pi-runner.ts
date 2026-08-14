import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  acknowledgeProcess,
  inspectProcess,
  readProcessOutput,
  requestProcessStop,
  startBackgroundProcess,
} from "@halqme/background-process";
import type { AgentTeamAgent, AgentTeamAgentFactory, AgentTeamMemberConfig } from "./team.ts";

const POLL_MS = 100;

export interface PiRunnerOptions {
  cwd: string;
  taskRoot: string;
  ownerSessionId: string;
  model?: string;
  tools: string[];
  timeoutMs: number;
}

export function createPiAgentFactory(options: PiRunnerOptions): AgentTeamAgentFactory {
  return async (member: AgentTeamMemberConfig, systemPrompt: string): Promise<AgentTeamAgent> => {
    const active = new Set<string>();
    const ask = async (prompt: string, signal?: AbortSignal): Promise<string> => {
      const args = ["-p", "--no-session"];
      if (member.model ?? options.model) args.push("--model", member.model ?? options.model!);
      if (options.tools.length) args.push("--tools", options.tools.join(","));
      args.push("--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes");
      for (const skill of member.skills ?? []) args.push("--skill", skill);
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
            await requestProcessStop(task.taskDir);
            throw new Error("agent-team was aborted");
          }
          const snapshot = await inspectProcess(task.taskDir);
          if (snapshot.phase === "unchecked" || snapshot.phase === "completed") {
            const output = await readProcessOutput(task.taskDir);
            await acknowledgeProcess(task.taskDir);
            if (snapshot.result?.outcome !== "success")
              throw new Error(output.stderr || snapshot.result?.error || "Pi process failed");
            return output.stdout.trim();
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        await requestProcessStop(task.taskDir);
        throw new Error(`Pi process timed out after ${options.timeoutMs}ms`);
      } finally {
        active.delete(task.taskDir);
      }
    };
    return {
      member,
      ask,
      stop: async () => {
        await Promise.all([...active].map((taskDir) => requestProcessStop(taskDir)));
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
