import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { SubagentRpcClient } from "./subagent-rpc.ts";
import {
  AgentTeam,
  type AgentTeamConfig,
  type AgentTeamInstructionPolicy,
  type AgentTeamMemberConfig,
  type AgentTeamSnapshot,
  type AgentTeamUpdate,
  formatAgentTeam,
} from "./team.ts";

const TOOL_NAME = "agent_team";
const STATUS_KEY = "agent-team";
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls", "web_search", "web_fetch"]);

interface AgentTeamToolParams {
  action: "start" | "list" | "check" | "answer" | "stop";
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
  if (requested?.some((tool) => !READ_ONLY_TOOLS.has(tool))) {
    throw new Error("agent-team only accepts known read-only tools");
  }
  return (requested ?? [...READ_ONLY_TOOLS]).filter((tool) => available.has(tool));
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

export default function agentTeamExtension(pi: ExtensionAPI): void {
  const teams = new Map<string, AgentTeam>();
  const subagentClient = new SubagentRpcClient(pi.events);

  pi.registerTool({
    name: TOOL_NAME,
    label: "agent-team",
    description:
      "Run a session-scoped team of Pi agents for either constructive committee discussion or focused adversarial review. Use committee mode to explore, compare, synthesize, or make a decision; use adversarial mode to challenge claims, designs, risks, or evidence. Consultative teams pause after independent opening statements and wait for user direction.",
    promptSnippet: "Choose constructive committee or adversarial review for a difficult question",
    promptGuidelines: [
      "Use agent_team for contested decisions, high-risk reviews, or work that benefits from independent perspectives.",
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
        Type.Literal("stop"),
      ]),
      id: Type.Optional(Type.String({ description: "agent-team ID" })),
      topic: Type.Optional(Type.String({ description: "Question or work item for a new team" })),
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
        Type.Array(Type.String(), {
          description: "Read-only tools available to team members",
        }),
      ),
      turnTimeoutMs: Type.Optional(
        Type.Integer({ minimum: 10_000, maximum: 900_000, default: 300_000 }),
      ),
    }),
    renderCall(args, theme, _context) {
      const topic = typeof args.topic === "string" ? args.topic.trim() : "";
      const text =
        theme.fg("toolTitle", theme.bold("agent_team")) +
        (topic ? ` ${theme.fg("accent", `Topic: ${topic}`)}` : "");
      return new Text(text, 0, 0);
    },
    async execute(
      _toolCallId: string,
      params: AgentTeamToolParams,
      signal: AbortSignal,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
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
          const thinking = params.thinking ?? pi.getThinkingLevel();
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
          };

          const team = new AgentTeam(config, (member, systemPrompt) => {
            const model = member.model ?? defaultModel;
            return subagentClient.startMember({
              member,
              systemPrompt,
              cwd: ctx.cwd,
              ...(model !== undefined ? { model } : {}),
              ...(thinking ? { thinking } : {}),
              timeoutMs,
              ...(member.skills?.length ? { skills: member.skills } : {}),
              ...(tools.length ? { tools } : {}),
            });
          });
          teams.set(id, team);
          updateStatus(ctx, teams);

          // Keep the tool call open until startup/consultation or autonomous
          // execution completes. The caller receives the result directly
          // instead of polling with sleep/check loops.
          const snapshot = await team.start(signal, createLiveReporter(ctx, topic));
          updateStatus(ctx, teams);
          return {
            content: [{ type: "text" as const, text: summarizeAgentTeamResult(snapshot) }],
            details: snapshot,
          };
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
          const snapshot = await team.answer(
            params.answer,
            signal,
            createLiveReporter(ctx, team.snapshot().topic),
          );
          updateStatus(ctx, teams);
          return {
            content: [{ type: "text" as const, text: summarizeAgentTeamResult(snapshot) }],
            details: snapshot,
          };
        }

        const snapshot = await team.stop();
        updateStatus(ctx, teams);
        return {
          content: [{ type: "text" as const, text: `Stopped ${snapshot.id}` }],
          details: snapshot,
        };
      } catch (error) {
        updateStatus(ctx, teams);
        return {
          content: [{ type: "text" as const, text: String(error) }],
          details: {},
          isError: true,
        };
      }
    },
  });

  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    updateStatus(ctx, teams);
  });
  pi.on("session_shutdown", async (_event: unknown, ctx: ExtensionContext) => {
    await Promise.allSettled([...teams.values()].map((team) => team.stop()));
    teams.clear();
    subagentClient.dispose();
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
