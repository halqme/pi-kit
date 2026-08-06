import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  HerdrAgentController,
  type AgentIsolation,
  type AgentStartSpec,
  type AgentSummary,
  type SettledStatus,
} from "./controller.ts";
import { HerdrCli, HerdrCliError } from "./herdr-cli.ts";
import { createAgentNamespace, type AgentNamespace } from "./namespace.ts";

const TOOL_NAME = "herdr_agents";
const STATUS_KEY = "herdr-agents";

type StartInput = {
  name: string;
  task: string;
  cwd?: string;
  isolation?: AgentIsolation;
  model?: string;
  branch?: string;
  base?: string;
  piArgs?: string[];
  wait?: boolean;
  timeoutMs?: number;
};

interface HerdrAgentsParams {
  action: "start" | "start_many" | "list" | "check" | "prompt" | "wait" | "interrupt" | "close";
  name?: string;
  task?: string;
  agents?: StartInput[];
  cwd?: string;
  isolation?: AgentIsolation;
  model?: string;
  branch?: string;
  base?: string;
  piArgs?: string[];
  prompt?: string;
  wait?: boolean;
  until?: SettledStatus[];
  timeoutMs?: number;
  lines?: number;
  removeWorktree?: boolean;
}

type PresentedAgent<T extends { name: string }> = Omit<T, "name"> & {
  name: string;
  physicalName: string;
};

function parentModel(ctx: ExtensionContext): string | undefined {
  return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
}

function resolveStartSpec(
  input: StartInput,
  defaults: Pick<
    HerdrAgentsParams,
    "cwd" | "isolation" | "model" | "base" | "piArgs" | "wait" | "timeoutMs"
  >,
  ctx: ExtensionContext,
): AgentStartSpec {
  const model = input.model?.trim() || defaults.model?.trim() || parentModel(ctx);
  const base = input.base?.trim() || defaults.base?.trim();
  const piArgs = input.piArgs ?? defaults.piArgs;
  const timeoutMs = input.timeoutMs ?? defaults.timeoutMs;
  return {
    name: input.name.trim(),
    task: input.task.trim(),
    cwd: input.cwd?.trim() || defaults.cwd?.trim() || ctx.cwd,
    isolation: input.isolation ?? defaults.isolation ?? "worktree",
    ...(model ? { model } : {}),
    ...(input.branch?.trim() ? { branch: input.branch.trim() } : {}),
    ...(base ? { base } : {}),
    ...(piArgs ? { piArgs: [...piArgs] } : {}),
    wait: input.wait ?? defaults.wait ?? false,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

function qualifyStartSpec(spec: AgentStartSpec, namespace: AgentNamespace): AgentStartSpec {
  return { ...spec, name: namespace.qualify(spec.name) };
}

function presentAgent<T extends { name: string }>(
  agent: T,
  namespace: AgentNamespace,
): PresentedAgent<T> {
  return {
    ...agent,
    name: namespace.logicalName(agent.name) ?? agent.name,
    physicalName: agent.name,
  };
}

function managedAgents(agents: AgentSummary[], namespace: AgentNamespace): AgentSummary[] {
  return agents
    .filter((agent) => namespace.owns(agent.name))
    .map((agent) => presentAgent(agent, namespace));
}

function formatAgent(agent: AgentSummary): string {
  const location = agent.cwd ?? agent.paneId;
  return `${agent.name} [${agent.status}] ${location}`;
}

async function updateStatus(
  ctx: ExtensionContext,
  controller: HerdrAgentController,
  namespace: AgentNamespace,
  autoStart: boolean,
): Promise<void> {
  try {
    const agents = managedAgents(await controller.list(undefined, autoStart), namespace);
    const working = agents.filter((agent) => agent.status === "working").length;
    const blocked = agents.filter((agent) => agent.status === "blocked").length;
    const done = agents.filter((agent) => agent.status === "done").length;
    const status = [
      working > 0 && `${working} working`,
      blocked > 0 && `${blocked} blocked`,
      done > 0 && `${done} done`,
    ]
      .filter(Boolean)
      .join(", ");
    ctx.ui.setStatus(STATUS_KEY, status || undefined);
  } catch (error) {
    if (error instanceof HerdrCliError && error.code === "server_not_running") {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    if (!autoStart) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    throw error;
  }
}

export default function herdrAgentsExtension(pi: ExtensionAPI): void {
  const controller = new HerdrAgentController(new HerdrCli());
  const namespaceCache = new Map<string, Promise<AgentNamespace>>();
  const namespaceFor = (ctx: ExtensionContext): Promise<AgentNamespace> => {
    let pending = namespaceCache.get(ctx.cwd);
    if (!pending) {
      pending = createAgentNamespace(ctx.cwd);
      namespaceCache.set(ctx.cwd, pending);
    }
    return pending;
  };

  pi.registerTool({
    name: TOOL_NAME,
    label: "herdr-agents",
    description:
      "Delegate implementation work to persistent, write-enabled Pi agents managed by Herdr. Agents run in isolated Git worktrees by default and survive parent Pi reloads or shutdowns. Use this for parallel coding, testing, migration, and review tasks that need file edits. Do not use it for read-only expert briefing or committee discussion; use agent_team for that. This tool never merges agent branches automatically.",
    promptSnippet: "Delegate parallel implementation work to persistent Herdr-managed Pi agents",
    promptGuidelines: [
      "Prefer worktree isolation for agents that may edit files. Use shared isolation only when concurrent writes are intentionally coordinated.",
      "Give each agent a bounded task with explicit ownership and validation requirements.",
      "Use start_many when tasks are independent and can run concurrently.",
      "Use check or wait to collect results; do not poll repeatedly while agents are still working.",
      "Inspect and integrate each worktree deliberately. Never assume a completed agent's changes are safe to merge.",
      "Delegated Pi agents do not auto-load extensions. Add only specifically required extensions through piArgs.",
    ],
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("start"),
        Type.Literal("start_many"),
        Type.Literal("list"),
        Type.Literal("check"),
        Type.Literal("prompt"),
        Type.Literal("wait"),
        Type.Literal("interrupt"),
        Type.Literal("close"),
      ]),
      name: Type.Optional(
        Type.String({ description: "Repository-local agent name, up to 25 characters" }),
      ),
      task: Type.Optional(Type.String({ description: "Initial implementation task" })),
      agents: Type.Optional(
        Type.Array(
          Type.Object({
            name: Type.String({ description: "Repository-local name, up to 25 characters" }),
            task: Type.String(),
            cwd: Type.Optional(Type.String()),
            isolation: Type.Optional(
              Type.Union([Type.Literal("worktree"), Type.Literal("shared")]),
            ),
            model: Type.Optional(Type.String()),
            branch: Type.Optional(Type.String()),
            base: Type.Optional(Type.String()),
            piArgs: Type.Optional(Type.Array(Type.String())),
            wait: Type.Optional(Type.Boolean()),
            timeoutMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 3_600_000 })),
          }),
          { minItems: 1, maxItems: 8 },
        ),
      ),
      cwd: Type.Optional(Type.String({ description: "Source checkout or shared workspace cwd" })),
      isolation: Type.Optional(
        Type.Union([Type.Literal("worktree"), Type.Literal("shared")], {
          description: "worktree by default; shared permits direct writes to cwd",
        }),
      ),
      model: Type.Optional(Type.String({ description: "Default Pi provider/model" })),
      branch: Type.Optional(Type.String({ description: "Branch name for a worktree agent" })),
      base: Type.Optional(Type.String({ description: "Base ref for a new worktree" })),
      piArgs: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Additional Pi CLI arguments. Automatic extension discovery stays disabled; use -e for explicit extensions.",
        }),
      ),
      prompt: Type.Optional(Type.String({ description: "Follow-up instruction" })),
      wait: Type.Optional(Type.Boolean({ description: "Wait for the submitted turn to settle" })),
      until: Type.Optional(
        Type.Array(
          Type.Union([
            Type.Literal("idle"),
            Type.Literal("done"),
            Type.Literal("blocked"),
            Type.Literal("unknown"),
          ]),
        ),
      ),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 3_600_000 })),
      lines: Type.Optional(Type.Integer({ minimum: 1, maximum: 2_000, default: 80 })),
      removeWorktree: Type.Optional(
        Type.Boolean({
          description:
            "Remove the worktree when closing. Dirty worktrees and active agents are rejected.",
        }),
      ),
    }),
    renderCall(args, theme, _context) {
      const action = typeof args.action === "string" ? args.action : "";
      const name = typeof args.name === "string" ? args.name : "";
      const suffix = [action, name].filter(Boolean).join(" ");
      return new Text(
        theme.fg("toolTitle", theme.bold("herdr_agents")) +
          (suffix ? ` ${theme.fg("accent", suffix)}` : ""),
        0,
        0,
      );
    },
    async execute(
      _toolCallId: string,
      params: HerdrAgentsParams,
      signal: AbortSignal,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      let namespace: AgentNamespace | undefined;
      try {
        namespace = await namespaceFor(ctx);

        if (params.action === "start") {
          if (!params.name?.trim()) throw new Error("name is required for start");
          if (!params.task?.trim()) throw new Error("task is required for start");
          const spec = qualifyStartSpec(
            resolveStartSpec(
              {
                name: params.name,
                task: params.task,
                ...(params.cwd ? { cwd: params.cwd } : {}),
                ...(params.isolation ? { isolation: params.isolation } : {}),
                ...(params.model ? { model: params.model } : {}),
                ...(params.branch ? { branch: params.branch } : {}),
                ...(params.base ? { base: params.base } : {}),
                ...(params.piArgs ? { piArgs: params.piArgs } : {}),
                ...(params.wait !== undefined ? { wait: params.wait } : {}),
                ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
              },
              {},
              ctx,
            ),
            namespace,
          );
          const rawAgent = await controller.start(spec, signal);
          const agent = presentAgent(rawAgent, namespace);
          await updateStatus(ctx, controller, namespace, true);
          return {
            content: [
              {
                type: "text" as const,
                text: `Started ${agent.name} [${agent.status}] in ${agent.cwd}\nWorkspace: ${agent.workspaceId}\n${agent.branch ? `Branch: ${agent.branch}\n` : ""}Attach: ${agent.attachCommand}`,
              },
            ],
            details: agent,
          };
        }

        if (params.action === "start_many") {
          if (!params.agents?.length) throw new Error("agents is required for start_many");
          const logicalNames = params.agents.map((agent) => agent.name.trim());
          if (new Set(logicalNames).size !== logicalNames.length) {
            throw new Error("agent names must be unique");
          }
          const defaults = {
            ...(params.cwd ? { cwd: params.cwd } : {}),
            ...(params.isolation ? { isolation: params.isolation } : {}),
            ...(params.model ? { model: params.model } : {}),
            ...(params.base ? { base: params.base } : {}),
            ...(params.piArgs ? { piArgs: params.piArgs } : {}),
            ...(params.wait !== undefined ? { wait: params.wait } : {}),
            ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
          };
          const specs = params.agents.map((agent) =>
            qualifyStartSpec(resolveStartSpec(agent, defaults, ctx), namespace!),
          );
          const rawResults = await controller.startMany(specs, signal);
          const results = rawResults.map((result, index) =>
            result.ok
              ? { ok: true as const, agent: presentAgent(result.agent, namespace!) }
              : {
                  ok: false as const,
                  name: logicalNames[index] ?? result.name,
                  error: result.error,
                },
          );
          await updateStatus(ctx, controller, namespace, true);
          return {
            content: [
              {
                type: "text" as const,
                text: results
                  .map((result) =>
                    result.ok
                      ? `started ${result.agent.name}: ${result.agent.cwd}${result.agent.branch ? ` (${result.agent.branch})` : ""}`
                      : `failed ${result.name}: ${result.error}`,
                  )
                  .join("\n"),
              },
            ],
            details: results,
            isError: results.every((result) => !result.ok),
          };
        }

        if (params.action === "list") {
          const agents = managedAgents(await controller.list(signal), namespace);
          await updateStatus(ctx, controller, namespace, true);
          return {
            content: [
              {
                type: "text" as const,
                text: agents.length
                  ? agents.map(formatAgent).join("\n")
                  : "No live Herdr agents for this repository.",
              },
            ],
            details: agents,
          };
        }

        if (!params.name?.trim()) throw new Error(`name is required for ${params.action}`);
        const logicalName = params.name.trim();
        const name = namespace.qualify(logicalName);

        if (params.action === "check") {
          const rawResult = await controller.check(name, params.lines ?? 80, signal);
          const result = { ...rawResult, agent: presentAgent(rawResult.agent, namespace) };
          await updateStatus(ctx, controller, namespace, true);
          return {
            content: [
              {
                type: "text" as const,
                text: `${formatAgent(result.agent)}\n\n${result.output || "(no terminal output)"}`,
              },
            ],
            details: result,
          };
        }

        if (params.action === "prompt") {
          if (!params.prompt?.trim()) throw new Error("prompt is required for prompt");
          const rawAgent = await controller.prompt(name, params.prompt, {
            wait: params.wait ?? false,
            ...(params.timeoutMs !== undefined ? { timeoutMs: params.timeoutMs } : {}),
            signal,
          });
          const agent = presentAgent(rawAgent, namespace);
          await updateStatus(ctx, controller, namespace, true);
          return {
            content: [{ type: "text" as const, text: formatAgent(agent) }],
            details: agent,
          };
        }

        if (params.action === "wait") {
          await controller.wait(
            name,
            params.until ?? ["idle", "done", "blocked"],
            params.timeoutMs,
            signal,
          );
          const rawResult = await controller.check(name, params.lines ?? 80, signal);
          const result = { ...rawResult, agent: presentAgent(rawResult.agent, namespace) };
          await updateStatus(ctx, controller, namespace, true);
          return {
            content: [
              {
                type: "text" as const,
                text: `${formatAgent(result.agent)}\n\n${result.output || "(no terminal output)"}`,
              },
            ],
            details: result,
          };
        }

        if (params.action === "interrupt") {
          const agent = presentAgent(await controller.interrupt(name, signal), namespace);
          await updateStatus(ctx, controller, namespace, true);
          return {
            content: [{ type: "text" as const, text: `Interrupted ${agent.name}` }],
            details: agent,
          };
        }

        const result = await controller.close(name, {
          removeWorktree: params.removeWorktree ?? false,
          signal,
        });
        await updateStatus(ctx, controller, namespace, true);
        return {
          content: [
            {
              type: "text" as const,
              text: result.removedWorktree
                ? `Closed ${logicalName} and removed worktree ${result.workspaceId}`
                : `Closed ${logicalName} workspace ${result.workspaceId}`,
            },
          ],
          details: { ...result, name: logicalName, physicalName: name },
        };
      } catch (error) {
        if (namespace) {
          try {
            await updateStatus(ctx, controller, namespace, false);
          } catch {
            // Preserve the operation error.
          }
        }
        return {
          content: [{ type: "text" as const, text: String(error) }],
          details: {},
          isError: true,
        };
      }
    },
  });

  pi.registerCommand("herdr-agents", {
    description: "List Herdr worker threads for this repository",
    handler: async (_args, ctx) => {
      const namespace = await namespaceFor(ctx);
      const agents = managedAgents(await controller.list(undefined), namespace);
      ctx.ui.notify(
        agents.length
          ? agents.map(formatAgent).join("\n")
          : "No live Herdr agents for this repository.",
        "info",
      );
      await updateStatus(ctx, controller, namespace, true);
    },
  });
  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    const namespace = await namespaceFor(ctx);
    await updateStatus(ctx, controller, namespace, false);
  });
  pi.on("session_shutdown", async (_event: unknown, ctx: ExtensionContext) => {
    // Herdr owns agent lifetimes. Parent Pi shutdown must not terminate delegated work.
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
