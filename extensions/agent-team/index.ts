import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { agentTeamTaskRoot, createPiAgentFactory } from "./pi-runner.ts";
import {
  AgentTeam,
  type AgentTeamConfig,
  type AgentTeamInstructionPolicy,
  type AgentTeamMemberConfig,
  type AgentTeamSnapshot,
  type AgentTeamUpdate,
  formatAgentTeam,
  type PersistedAgentTeam,
} from "./team.ts";

const TOOL_NAME = "agent_team";
const STATUS_KEY = "agent-team";
const READ_ONLY_TOOL_NAMES = ["read", "grep", "find", "ls", "web_search", "web_fetch"] as const;
const READ_ONLY_TOOLS = new Set<string>(READ_ONLY_TOOL_NAMES);

interface AgentTeamToolParams {
  action: "start" | "list" | "check" | "answer" | "revisit" | "stop";
  id?: string;
  topic?: string;
  mode?: "committee" | "adversarial";
  interaction?: "autonomous" | "consultative";
  model?: string;
  skills?: string[];
  members?: Array<{
    name: string;
    role: string;
    instructionPolicy?: AgentTeamInstructionPolicy;
    model?: string;
    skills?: string[];
  }>;
  maxRounds?: number;
  answer?: string;
  thinking?: string;
  tools?: string[];
  turnTimeoutMs?: number;
}

function selectTools(requested: string[] | undefined, available: Set<string>): string[] {
  const unsupported = requested?.filter((tool) => !READ_ONLY_TOOLS.has(tool)) ?? [];
  if (unsupported.length > 0) {
    throw new Error(
      `agent-team only accepts supported read-only tools (${READ_ONLY_TOOL_NAMES.join(", ")}); unsupported: ${unsupported.join(", ")}`,
    );
  }
  return (requested ?? [...READ_ONLY_TOOL_NAMES]).filter((tool) => available.has(tool));
}

async function resolveSkill(spec: string, cwd: string): Promise<string> {
  const value = spec.trim();
  if (!value) throw new Error("skill names and paths must not be empty");
  const candidates = isAbsolute(value)
    ? [value]
    : [
        resolve(cwd, value),
        resolve(cwd, ".pi/skills", value, "SKILL.md"),
        resolve(cwd, ".agents/skills", value, "SKILL.md"),
        join(homedir(), ".pi/agent/skills", value, "SKILL.md"),
        join(homedir(), ".agents/skills", value, "SKILL.md"),
      ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next supported skill location.
    }
  }
  throw new Error(`Could not resolve skill '${value}' from ${cwd}`);
}

async function resolveSkills(specs: string[] | undefined, cwd: string): Promise<string[]> {
  return [...new Set(await Promise.all((specs ?? []).map((spec) => resolveSkill(spec, cwd))))];
}

function summarizeTeams(teams: Map<string, AgentTeam>): AgentTeamSnapshot[] {
  return [...teams.values()].map((team) => team.snapshot());
}

const AGENT_TEAM_STATE_ENTRY = "agent-team-state";

function appendTeamState(pi: ExtensionAPI, team: AgentTeam): void {
  pi.appendEntry(AGENT_TEAM_STATE_ENTRY, team.persisted());
}

function createTeamAgentFactory(
  ctx: ExtensionContext,
  state: Pick<PersistedAgentTeam, "model" | "tools" | "timeoutMs"> | AgentTeamConfig,
) {
  return createPiAgentFactory({
    cwd: ctx.cwd,
    taskRoot: agentTeamTaskRoot(
      ctx.sessionManager.getSessionDir(),
      ctx.sessionManager.getSessionId(),
    ),
    ownerSessionId: ctx.sessionManager.getSessionId(),
    ...(state.model !== undefined ? { model: state.model } : {}),
    tools: (state.tools ?? []).filter((tool) => READ_ONLY_TOOLS.has(tool)),
    timeoutMs: state.timeoutMs ?? 300_000,
  });
}

function restoreTeams(ctx: ExtensionContext, teams: Map<string, AgentTeam>): void {
  teams.clear();
  const restored = new Map<string, AgentTeam>();
  for (const entry of [...ctx.sessionManager.getEntries()].reverse()) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as { type?: unknown; customType?: unknown; data?: unknown };
    if (candidate.type !== "custom" || candidate.customType !== AGENT_TEAM_STATE_ENTRY) continue;
    const data = candidate.data;
    if (!data || typeof data !== "object") continue;
    const state = data as PersistedAgentTeam;
    if (typeof state.id !== "string" || restored.has(state.id)) continue;
    try {
      restored.set(state.id, AgentTeam.fromPersisted(state, createTeamAgentFactory(ctx, state)));
    } catch {
      // Ignore malformed historical entries without affecting the live session.
    }
  }
  for (const [id, team] of restored) teams.set(id, team);
}

function summarizeAgentTeamResult(snapshot: AgentTeamSnapshot): string {
  return formatAgentTeam(snapshot);
}

function updateStatus(ctx: ExtensionContext, teams: Map<string, AgentTeam>): void {
  const snapshots = summarizeTeams(teams);
  const running = snapshots.filter(
    (team) => team.status === "running" || team.status === "starting",
  ).length;
  const waiting = snapshots.filter((team) => team.status === "awaiting-user").length;
  const failed = snapshots.filter((team) => team.status === "failed").length;
  const status = [
    running && `${running} running`,
    waiting && `${waiting} awaiting user`,
    failed && `${failed} failed`,
  ]
    .filter(Boolean)
    .join(", ");
  ctx.ui.setStatus(STATUS_KEY, status || undefined);
}

function createLiveReporter(ctx: ExtensionContext, topic: string): AgentTeamUpdate {
  return async (update) => {
    if (typeof update === "string") {
      ctx.ui.setStatus(STATUS_KEY, `agent-team [${topic}]: ${update}`);
      return;
    }
    ctx.ui.setStatus(
      STATUS_KEY,
      `agent-team [${topic}]: ${update.member} (${update.phase}, round ${update.round})`,
    );
  };
}

function createPersistingReporter(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  team: AgentTeam,
  topic: string,
): AgentTeamUpdate {
  const live = createLiveReporter(ctx, topic);
  return async (update) => {
    await live(update);
    appendTeamState(pi, team);
  };
}

export default function agentTeamExtension(pi: ExtensionAPI): void {
  const teams = new Map<string, AgentTeam>();

  pi.registerTool({
    name: TOOL_NAME,
    label: "agent-team",
    description:
      "Run a session-scoped, read-only team of Pi agents to support human or parent-agent judgment through constructive committee discussion or focused adversarial review. Use committee mode to explore, compare, synthesize, or make a recommendation; use adversarial mode to challenge claims, designs, risks, or evidence. Team results are advisory: agent_team does not mutate project state or establish verification. Consultative teams pause after independent opening statements and wait for user direction.",
    promptSnippet: "Choose constructive committee or adversarial review for a difficult question",
    promptGuidelines: [
      "Use agent_team for contested decisions, high-risk reviews, or work that benefits from independent perspectives.",
      "Treat team output as advisory evidence for human or parent-agent judgment, not as an implementation or verification result.",
      "Choose committee mode for exploration, brainstorming, comparison, synthesis, or a balanced recommendation.",
      "Choose adversarial mode for critique, red-teaming, debugging competing explanations, or stress-testing a proposed decision; challenge claims and assumptions, not people.",
      "If the requested stance is ambiguous, prefer committee mode and explain the chosen mode in the topic or member roles.",
      "For adversarial mode, assign genuinely opposing roles such as advocate and skeptic; for committee mode, assign complementary expert roles.",
    ],
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("start"),
        Type.Literal("list"),
        Type.Literal("check"),
        Type.Literal("answer"),
        Type.Literal("revisit"),
        Type.Literal("stop"),
      ]),
      id: Type.Optional(Type.String({ description: "agent-team ID" })),
      topic: Type.Optional(
        Type.String({ description: "Question for start, or new information for revisit" }),
      ),
      mode: Type.Optional(
        Type.Union([Type.Literal("committee"), Type.Literal("adversarial")], {
          description:
            "committee for constructive exploration and synthesis; adversarial for focused challenge and red-team review",
        }),
      ),
      interaction: Type.Optional(
        Type.Union([Type.Literal("autonomous"), Type.Literal("consultative")], {
          description:
            "autonomous to complete the discussion now; consultative to pause after opening statements for user direction",
        }),
      ),
      model: Type.Optional(
        Type.String({
          description:
            "Default provider/model for all members. A member-level model overrides this value.",
        }),
      ),
      skills: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Skill names or SKILL.md paths to load for every member; automatic skill discovery remains enabled",
        }),
      ),
      members: Type.Optional(
        Type.Array(
          Type.Object({
            name: Type.String({ description: "Unique member name" }),
            role: Type.String({ description: "Expert mandate or review responsibility" }),
            instructionPolicy: Type.Optional(
              Type.Union([Type.Literal("user-obedient"), Type.Literal("goal-driven")], {
                description:
                  "Whether to follow user direction faithfully or prioritize the team's objective",
              }),
            ),
            model: Type.Optional(Type.String({ description: "Optional provider/model override" })),
            skills: Type.Optional(
              Type.Array(Type.String(), {
                description:
                  "Skill names or SKILL.md paths for this member; overrides team defaults",
              }),
            ),
          }),
          { minItems: 2, maxItems: 6 },
        ),
      ),
      maxRounds: Type.Optional(
        Type.Integer({
          minimum: 0,
          maximum: 4,
          default: 1,
          description: "Discussion rounds after independent opening statements",
        }),
      ),
      answer: Type.Optional(Type.String({ description: "User direction for a waiting team" })),
      thinking: Type.Optional(Type.String({ description: "Thinking level for child Pi agents" })),
      tools: Type.Optional(
        Type.Array(StringEnum(READ_ONLY_TOOL_NAMES), {
          description:
            "Optional allowlist of supported read-only tools for team members. Omit to use every supported read-only tool that is currently available.",
        }),
      ),
      turnTimeoutMs: Type.Optional(
        Type.Integer({ minimum: 10_000, maximum: 900_000, default: 300_000 }),
      ),
    }),
    renderCall(args, theme, _context) {
      const action = typeof args.action === "string" ? args.action : "";
      const topic = typeof args.topic === "string" ? args.topic.trim() : "";
      const text =
        theme.fg("toolTitle", theme.bold("agent_team")) +
        (action ? ` ${theme.fg("accent", action)}` : "") +
        (topic ? ` ${theme.fg("dim", topic)}` : "");
      return new Text(text, 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("warning", "Running agent team..."), 0, 0);
      const content = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text ?? "")
        .join("\n");
      const snapshots = Array.isArray(result.details) ? result.details : [result.details];
      if (snapshots.length === 0 || !snapshots[0]) {
        const text = context.isError ? content || "Agent-team failed." : "No agent-team session.";
        return new Text(theme.fg(context.isError ? "error" : "toolOutput", text), 0, 0);
      }
      const snapshot = snapshots[0];
      let text =
        snapshots.length > 1
          ? snapshots
              .map((item) => {
                const answer = item.finalAnswer?.trim();
                const preview = answer
                  ? ` — ${answer.length > 120 ? `${answer.slice(0, 117)}...` : answer}`
                  : "";
                return `${item.id} [${item.mode}:${item.status}] ${item.completedRounds}/${item.maxRounds} round(s)${preview}`;
              })
              .join("\n")
          : `${snapshot.status} · ${snapshot.mode} · ${snapshot.members?.length ?? 0} member(s) · ${snapshot.completedRounds}/${snapshot.maxRounds} round(s)`;
      if (snapshots.length === 1 && snapshot.finalAnswer) {
        const answer = snapshot.finalAnswer.trim();
        text += `\n${answer.length > 240 && !expanded ? `${answer.slice(0, 237)}...` : answer}`;
      }
      if (snapshot.error) text += `\nError: ${snapshot.error}`;
      if (expanded) {
        text += `\n\n${snapshots.map((item) => formatAgentTeam(item)).join("\n\n")}`;
        text += `\n\n${JSON.stringify(result.details, null, 2)}`;
      }
      return new Text(theme.fg(context.isError ? "error" : "toolOutput", text), 0, 0);
    },
    async execute(
      _toolCallId: string,
      params: AgentTeamToolParams,
      signal: AbortSignal,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<{
      content: Array<{ type: "text"; text: string }>;
      details: AgentTeamSnapshot | AgentTeamSnapshot[];
    }> {
      try {
        if (params.action === "list") {
          const snapshots = summarizeTeams(teams);
          return {
            content: [
              {
                type: "text" as const,
                text: snapshots.length
                  ? snapshots
                      .map((team) => `${team.id} [${team.mode}:${team.status}] ${team.topic}`)
                      .join("\n")
                  : "No agent-team sessions.",
              },
            ],
            details: snapshots,
          };
        }

        if (params.action === "start") {
          const topic = params.topic?.trim();
          if (!topic) throw new Error("topic is required for start");
          if (!params.members || params.members.length < 2) {
            throw new Error("at least two members are required for start");
          }
          const names = params.members.map((member) => member.name.trim());
          if (names.some((name) => !name)) throw new Error("member names must not be empty");
          if (new Set(names).size !== names.length) throw new Error("member names must be unique");
          if (params.members.some((member) => !member.role.trim())) {
            throw new Error("member roles must not be empty");
          }

          const id = randomUUID();
          const availableTools = new Set(pi.getAllTools().map((tool) => tool.name));
          const tools = selectTools(params.tools, availableTools);
          const parentModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
          const defaultModel = params.model?.trim() || parentModel;
          const timeoutMs = params.turnTimeoutMs ?? 300_000;
          const teamSkills = await resolveSkills(params.skills, ctx.cwd);
          const members: AgentTeamMemberConfig[] = await Promise.all(
            params.members.map(async (member) => {
              const skills = await resolveSkills(member.skills ?? teamSkills, ctx.cwd);
              return {
                name: member.name.trim(),
                role: member.role.trim(),
                ...(member.instructionPolicy
                  ? { instructionPolicy: member.instructionPolicy }
                  : {}),
                ...(member.model?.trim() ? { model: member.model.trim() } : {}),
                ...(skills.length > 0 ? { skills } : {}),
              };
            }),
          );
          const config: AgentTeamConfig = {
            id,
            topic,
            mode: params.mode ?? "committee",
            interaction: params.interaction ?? "autonomous",
            members,
            maxRounds: params.maxRounds ?? 1,
            ...(defaultModel !== undefined ? { model: defaultModel } : {}),
            tools,
            timeoutMs,
          };

          const team = new AgentTeam(
            config,
            createTeamAgentFactory(ctx, {
              ...config,
              tools,
            }),
          );
          teams.set(id, team);
          appendTeamState(pi, team);
          updateStatus(ctx, teams);

          // Keep the tool call open until startup/consultation or autonomous
          // execution completes. The caller receives the result directly
          // instead of polling with sleep/check loops.
          try {
            const snapshot = await team.start(
              signal,
              createPersistingReporter(pi, ctx, team, topic),
            );
            appendTeamState(pi, team);
            updateStatus(ctx, teams);
            return {
              content: [{ type: "text" as const, text: summarizeAgentTeamResult(snapshot) }],
              details: snapshot,
            };
          } catch (error) {
            appendTeamState(pi, team);
            throw error;
          }
        }

        if (!params.id) throw new Error(`id is required for ${params.action}`);
        const team = teams.get(params.id);
        if (!team) throw new Error(`Unknown agent-team: ${params.id}`);

        if (params.action === "check") {
          const snapshot = team.snapshot();
          return {
            content: [{ type: "text" as const, text: summarizeAgentTeamResult(snapshot) }],
            details: snapshot,
          };
        }

        if (params.action === "answer") {
          if (!params.answer?.trim()) throw new Error("answer is required for answer");
          try {
            const snapshot = await team.answer(
              params.answer,
              signal,
              createPersistingReporter(pi, ctx, team, team.snapshot().topic),
            );
            appendTeamState(pi, team);
            updateStatus(ctx, teams);
            return {
              content: [{ type: "text" as const, text: summarizeAgentTeamResult(snapshot) }],
              details: snapshot,
            };
          } catch (error) {
            appendTeamState(pi, team);
            throw error;
          }
        }

        if (params.action === "revisit") {
          if (!params.topic?.trim()) throw new Error("topic is required for revisit");
          try {
            const snapshot = await team.revisit(
              params.topic,
              signal,
              createPersistingReporter(pi, ctx, team, team.snapshot().topic),
            );
            appendTeamState(pi, team);
            updateStatus(ctx, teams);
            return {
              content: [{ type: "text" as const, text: summarizeAgentTeamResult(snapshot) }],
              details: snapshot,
            };
          } catch (error) {
            appendTeamState(pi, team);
            throw error;
          }
        }

        const snapshot = await team.stop();
        appendTeamState(pi, team);
        updateStatus(ctx, teams);
        return {
          content: [{ type: "text" as const, text: `Stopped ${snapshot.id}` }],
          details: snapshot,
        };
      } catch (error) {
        updateStatus(ctx, teams);
        throw error;
      }
    },
  });

  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    restoreTeams(ctx, teams);
    updateStatus(ctx, teams);
  });
  pi.on("session_shutdown", async (_event: unknown, ctx: ExtensionContext) => {
    await Promise.allSettled([...teams.values()].map((team) => team.stop()));
    for (const team of teams.values()) appendTeamState(pi, team);
    teams.clear();
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
