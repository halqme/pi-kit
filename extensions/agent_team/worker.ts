import { atomicWriteJson } from "@halqme/background_process";
import { agentTeamTaskRoot, createPiAgentFactory } from "./pi-runner.ts";
import { AGENT_TEAM_TOOL_NAMES } from "./policy.ts";
import {
  AgentTeam,
  type AgentTeamConfig,
  type AgentTeamUpdate,
  type PersistedAgentTeam,
} from "./team.ts";

type AgentTeamJobOperation =
  | { action: "start" }
  | { action: "answer"; answer: string }
  | { action: "revisit"; topic: string };

interface AgentTeamWorkerRequest {
  version: 1;
  taskDir: string;
  statePath: string;
  sessionDir: string;
  sessionId: string;
  cwd: string;
  config: AgentTeamConfig;
  operation: AgentTeamJobOperation;
  initial?: PersistedAgentTeam;
}

async function readRequest(): Promise<AgentTeamWorkerRequest> {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input) as AgentTeamWorkerRequest;
  if (!request || request.version !== 1) throw new Error("invalid agent-team worker request");
  if (!request.taskDir || !request.statePath || !request.sessionDir || !request.sessionId) {
    throw new Error("incomplete agent-team worker request");
  }
  return request;
}

async function main(): Promise<void> {
  const request = await readRequest();
  const taskRoot = agentTeamTaskRoot(request.sessionDir, request.sessionId);
  const createAgent = createPiAgentFactory({
    cwd: request.cwd,
    taskRoot,
    ownerSessionId: request.sessionId,
    ...(request.config.model !== undefined ? { model: request.config.model } : {}),
    tools: request.config.tools ?? [...AGENT_TEAM_TOOL_NAMES],
    ...(request.config.thinking !== undefined ? { thinking: request.config.thinking } : {}),
    timeoutMs: request.config.timeoutMs ?? 300_000,
  });
  const team = request.initial
    ? AgentTeam.fromPersisted(request.initial, createAgent)
    : new AgentTeam(request.config, createAgent);

  let persistQueue = Promise.resolve();
  const persist = async (): Promise<void> => {
    persistQueue = persistQueue.then(() => atomicWriteJson(request.statePath, team.persisted()));
    await persistQueue;
  };
  const onUpdate: AgentTeamUpdate = async () => {
    await persist();
  };

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await team.stop();
    await persist();
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());

  await persist();
  try {
    if (request.operation.action === "start") {
      await team.start(undefined, onUpdate);
    } else if (request.operation.action === "answer") {
      await team.answer(request.operation.answer, undefined, onUpdate);
    } else {
      await team.revisit(request.operation.topic, undefined, onUpdate);
    }
    await persist();
  } catch (error) {
    await persist();
    throw error;
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
}
