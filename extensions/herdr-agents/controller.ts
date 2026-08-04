import type { HerdrResponse } from "./herdr-cli.ts";

export type AgentIsolation = "worktree" | "shared";
export type SettledStatus = "idle" | "done" | "blocked" | "unknown";

export interface HerdrClient {
  json(
    args: string[],
    options?: { signal?: AbortSignal | undefined; autoStart?: boolean | undefined },
  ): Promise<HerdrResponse>;
  text(
    args: string[],
    options?: { signal?: AbortSignal | undefined; autoStart?: boolean | undefined },
  ): Promise<string>;
}

export interface AgentStartSpec {
  name: string;
  task: string;
  cwd: string;
  isolation?: AgentIsolation;
  model?: string;
  branch?: string;
  base?: string;
  piArgs?: string[];
  wait?: boolean;
  timeoutMs?: number;
}

export interface StartedAgent {
  name: string;
  status: string;
  workspaceId: string;
  paneId: string;
  cwd: string;
  branch?: string;
  isolation: AgentIsolation;
  attachCommand: string;
}

export interface AgentSummary {
  name: string;
  status: string;
  workspaceId: string;
  paneId: string;
  cwd?: string;
  agent?: string;
}

export interface AgentCheckResult {
  agent: AgentSummary;
  output: string;
}

export class HerdrAgentController {
  constructor(private readonly client: HerdrClient) {}

  async start(spec: AgentStartSpec, signal?: AbortSignal): Promise<StartedAgent> {
    validateName(spec.name);
    if (!spec.task.trim()) throw new Error("task is required");
    const isolation = spec.isolation ?? "worktree";
    const location = await this.createLocation(spec, isolation, signal);
    const piArgs = withDelegationBoundary(spec.piArgs);
    if (spec.model?.trim()) piArgs.unshift("--model", spec.model.trim());
    const startArgs = [
      "agent",
      "start",
      spec.name,
      "--kind",
      "pi",
      "--pane",
      location.paneId,
      "--timeout",
      String(Math.min(Math.max(spec.timeoutMs ?? 30_000, 3_001), 300_000)),
      "--",
      ...piArgs,
    ];

    try {
      await this.client.json(startArgs, { signal });
    } catch (error) {
      await this.cleanupFailedStart(location.workspaceId, isolation);
      throw error;
    }

    // Once the interactive agent exists, preserve its workspace even if prompt
    // submission or waiting fails. The caller can inspect, retry, or close it.
    const prompted = await this.prompt(spec.name, buildDelegationPrompt(spec.task), {
      wait: spec.wait ?? false,
      timeoutMs: spec.timeoutMs,
      signal,
    });
    return {
      name: spec.name,
      status: prompted.status,
      workspaceId: location.workspaceId,
      paneId: location.paneId,
      cwd: location.cwd,
      ...(location.branch ? { branch: location.branch } : {}),
      isolation,
      attachCommand: `herdr agent attach ${spec.name}`,
    };
  }

  async startMany(
    specs: AgentStartSpec[],
    signal?: AbortSignal,
  ): Promise<
    Array<{ ok: true; agent: StartedAgent } | { ok: false; name: string; error: string }>
  > {
    const names = specs.map((spec) => spec.name);
    if (new Set(names).size !== names.length) throw new Error("agent names must be unique");
    const results = await Promise.allSettled(specs.map((spec) => this.start(spec, signal)));
    return results.map((result, index) => {
      const name = specs[index]?.name ?? "unknown";
      return result.status === "fulfilled"
        ? { ok: true as const, agent: result.value }
        : { ok: false as const, name, error: String(result.reason) };
    });
  }

  async list(signal?: AbortSignal, autoStart = true): Promise<AgentSummary[]> {
    const response = await this.client.json(["agent", "list"], { signal, autoStart });
    return agentsFromResponse(response);
  }

  async check(name: string, lines = 80, signal?: AbortSignal): Promise<AgentCheckResult> {
    validateName(name);
    const response = await this.client.json(["agent", "get", name], { signal });
    const agent = agentFromResponse(response);
    const source =
      agent.status === "idle" || agent.status === "done" ? "recent-unwrapped" : "visible";
    const output = await this.client.text(
      ["agent", "read", name, "--source", source, "--lines", String(clampLines(lines))],
      { signal },
    );
    return { agent, output };
  }

  async prompt(
    name: string,
    prompt: string,
    options: {
      wait?: boolean | undefined;
      timeoutMs?: number | undefined;
      signal?: AbortSignal | undefined;
    } = {},
  ): Promise<AgentSummary> {
    validateName(name);
    if (!prompt.trim()) throw new Error("prompt is required");
    const args = ["agent", "prompt", name, prompt];
    if (options.wait) {
      args.push("--wait");
      if (options.timeoutMs !== undefined) args.push("--timeout", String(options.timeoutMs));
    }
    const response = await this.client.json(args, { signal: options.signal });
    return agentFromResponse(response);
  }

  async wait(
    name: string,
    until: SettledStatus[] = ["idle", "done", "blocked"],
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<AgentSummary> {
    validateName(name);
    const args = ["agent", "wait", name];
    for (const status of until) args.push("--until", status);
    if (timeoutMs !== undefined) args.push("--timeout", String(timeoutMs));
    const response = await this.client.json(args, { signal });
    return agentFromResponse(response);
  }

  async interrupt(name: string, signal?: AbortSignal): Promise<AgentSummary> {
    validateName(name);
    const before = await this.client.json(["agent", "get", name], { signal });
    const agent = agentFromResponse(before);
    await this.client.json(["agent", "send-keys", name, "ctrl+c"], { signal });
    return agent;
  }

  async close(
    name: string,
    options: {
      removeWorktree?: boolean | undefined;
      signal?: AbortSignal | undefined;
    } = {},
  ): Promise<{ workspaceId: string; removedWorktree: boolean }> {
    validateName(name);
    const response = await this.client.json(["agent", "get", name], {
      signal: options.signal,
    });
    const agent = agentFromResponse(response);
    if (agent.status !== "idle" && agent.status !== "done") {
      throw new Error(
        `Refusing to close ${name} while its lifecycle state is '${agent.status}'. Interrupt or wait for it to settle first.`,
      );
    }
    if (options.removeWorktree) {
      await this.client.json(["worktree", "remove", "--workspace", agent.workspaceId], {
        signal: options.signal,
      });
      return { workspaceId: agent.workspaceId, removedWorktree: true };
    }
    await this.client.json(["workspace", "close", agent.workspaceId], {
      signal: options.signal,
    });
    return { workspaceId: agent.workspaceId, removedWorktree: false };
  }

  private async createLocation(
    spec: AgentStartSpec,
    isolation: AgentIsolation,
    signal?: AbortSignal,
  ): Promise<{ workspaceId: string; paneId: string; cwd: string; branch?: string }> {
    const label = `pi-agent:${spec.name}`;
    if (isolation === "worktree") {
      const args = ["worktree", "create", "--cwd", spec.cwd, "--label", label, "--no-focus"];
      if (spec.branch?.trim()) args.push("--branch", spec.branch.trim());
      if (spec.base?.trim()) args.push("--base", spec.base.trim());
      const response = await this.client.json(args, { signal });
      const result = responseResult(response);
      const workspace = requireRecord(result.workspace, "workspace");
      const pane = requireRecord(result.root_pane, "root_pane");
      const worktree = requireRecord(result.worktree, "worktree");
      return {
        workspaceId: requireString(workspace.workspace_id ?? workspace.id, "workspace id"),
        paneId: requireString(pane.pane_id ?? pane.id, "pane id"),
        cwd: requireString(worktree.path, "worktree path"),
        ...(typeof worktree.branch === "string" ? { branch: worktree.branch } : {}),
      };
    }

    const response = await this.client.json(
      ["workspace", "create", "--cwd", spec.cwd, "--label", label, "--no-focus"],
      { signal },
    );
    const result = responseResult(response);
    const workspace = requireRecord(result.workspace, "workspace");
    const pane = requireRecord(result.root_pane, "root_pane");
    return {
      workspaceId: requireString(workspace.workspace_id ?? workspace.id, "workspace id"),
      paneId: requireString(pane.pane_id ?? pane.id, "pane id"),
      cwd: spec.cwd,
    };
  }

  private async cleanupFailedStart(workspaceId: string, isolation: AgentIsolation): Promise<void> {
    try {
      if (isolation === "worktree") {
        await this.client.json(["worktree", "remove", "--workspace", workspaceId, "--force"], {
          autoStart: false,
        });
      } else {
        await this.client.json(["workspace", "close", workspaceId], { autoStart: false });
      }
    } catch {
      // Preserve the original startup failure. The orphan remains inspectable in Herdr.
    }
  }
}

export function buildDelegationPrompt(task: string): string {
  return [
    "You are a delegated implementation agent controlled by a parent Pi session through Herdr.",
    "Work directly in the current checkout. You may inspect and edit files and run validation commands.",
    "Do not start, delegate to, or coordinate other agents. Return control to the parent Pi instead.",
    "Do not merge branches, remove the worktree, or modify another checkout.",
    "When the task is complete or blocked, report the result, changed files, checks run, and remaining risks.",
    "",
    "Task:",
    task.trim(),
  ].join("\n");
}

export function validateName(name: string): void {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name)) {
    throw new Error("agent name must match [a-z][a-z0-9_-]{0,31}");
  }
}

function withDelegationBoundary(piArgs: string[] | undefined): string[] {
  const args = [...(piArgs ?? [])];
  return args.includes("--no-extensions") ? args : ["--no-extensions", ...args];
}

function clampLines(lines: number): number {
  return Math.min(Math.max(Math.trunc(lines), 1), 2_000);
}

function agentsFromResponse(response: HerdrResponse): AgentSummary[] {
  const result = responseResult(response);
  const raw = Array.isArray(result.agents) ? result.agents : [];
  return raw.map((value) => agentFromRecord(requireRecord(value, "agent")));
}

function agentFromResponse(response: HerdrResponse): AgentSummary {
  const result = responseResult(response);
  return agentFromRecord(requireRecord(result.agent, "agent"));
}

function agentFromRecord(agent: Record<string, unknown>): AgentSummary {
  return {
    name: requireString(agent.name ?? agent.pane_id, "agent name"),
    status: requireString(agent.agent_status ?? agent.status ?? "unknown", "agent status"),
    workspaceId: requireString(agent.workspace_id, "workspace id"),
    paneId: requireString(agent.pane_id, "pane id"),
    ...(typeof agent.cwd === "string" ? { cwd: agent.cwd } : {}),
    ...(typeof agent.agent === "string" ? { agent: agent.agent } : {}),
  };
}

function responseResult(response: HerdrResponse): Record<string, unknown> {
  return requireRecord(response.result, "result");
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Herdr response did not include ${label}`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`Herdr response did not include ${label}`);
  }
  return value;
}
