import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  appendAgentTeamState,
  createAgentTeamJob,
  launchAgentTeamWorker,
  refreshAgentTeamJobs,
  restoreAgentTeamJobs,
  stopAgentTeamJob,
  summarizeAgentTeamJobs,
  type AgentTeamJob,
} from "./runtime.ts";
import {
  type AgentTeamConfig,
  type AgentTeamInstructionPolicy,
  type AgentTeamMemberConfig,
  type AgentTeamSnapshot,
  formatAgentTeam,
} from "./team.ts";
import {
  AGENT_TEAM_THINKING_LEVELS,
  AGENT_TEAM_TOOL_NAMES,
  validateAgentTeamThinking,
  validateAgentTeamTools,
  type AgentTeamThinkingLevel,
} from "./policy.ts";

const TOOL_NAME = "agent_team";
const STATUS_KEY = "agent-team";
const READ_ONLY_TOOL_NAMES = AGENT_TEAM_TOOL_NAMES;

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
  thinking?: AgentTeamThinkingLevel;
  tools?: string[];
  turnTimeoutMs?: number;
}

function selectTools(requested: string[] | undefined): string[] {
  return validateAgentTeamTools(requested);
}

export async function resolveSkill(spec: string, cwd: string): Promise<string> {
  const value = spec.trim();
  if (!value) throw new Error("skill names and paths must not be empty");
  const candidates = isAbsolute(value)
    ? [value]
    : [
        resolve(cwd, value),
        resolve(cwd, "skills", value, "SKILL.md"),
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
  const resolved: string[] = [];
  for (const spec of specs ?? []) {
    const skill = await resolveSkill(spec, cwd);
    if (!resolved.includes(skill)) resolved.push(skill);
  }
  return resolved;
}

function summarizeAgentTeamResult(snapshot: AgentTeamSnapshot): string {
  return formatAgentTeam(snapshot);
}

export default function agentTeamExtension(pi: ExtensionAPI): void {
  const jobs = new Map<string, AgentTeamJob>();
  let timer: NodeJS.Timeout | undefined;
  let activeContext: ExtensionContext | undefined;
  let refreshPromise: Promise<void> | undefined;

  function updateJobStatus(ctx: ExtensionContext): void {
    const snapshots = summarizeAgentTeamJobs(jobs);
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

  async function refresh(ctx: ExtensionContext, notify = false): Promise<void> {
    if (refreshPromise) {
      await refreshPromise;
      return;
    }
    const current = (async () => {
      await refreshAgentTeamJobs(pi, ctx, jobs, { notify });
      updateJobStatus(ctx);
    })();
    refreshPromise = current;
    try {
      await current;
    } finally {
      if (refreshPromise === current) refreshPromise = undefined;
    }
  }

  function startedText(snapshot: AgentTeamSnapshot): string {
    return [
      `Started agent-team ${snapshot.id} in the background.`,
      `Use action check with id ${snapshot.id} for current progress; completion is delivered automatically.`,
      "",
      summarizeAgentTeamResult(snapshot),
    ].join("\n");
  }

  pi.registerTool({
    name: TOOL_NAME,
    label: "agent-team",
    description:
      "Start a session-scoped, read-only team of Pi agents as a durable background job to support high-value human or parent-agent judgment through constructive committee discussion or focused adversarial review. Use agent_team sparingly: before a material design decision, when blocked by multiple plausible causes, or to review a large/high-impact change. Do not use it for routine or frequent reviews, simple checks, implementation work, or verification. The start, answer, and revisit actions return immediately; use check for explicit progress and receive completion notifications automatically. Team results are advisory: agent_team does not mutate project state or establish verification. Consultative teams pause after independent opening statements and wait for user direction.",
    promptSnippet: "Choose constructive committee or adversarial review for a difficult question",
    promptGuidelines: [
      "Use agent_team sparingly and only for high-value judgment: before a material design or architecture decision, when blocked and there are multiple plausible causes, or to review a large/high-impact change.",
      "Do not use agent_team for routine or frequent reviews, simple checks, normal implementation work, or verification.",
      "For frequent lightweight review requests, use background_process to start a detached non-interactive command such as `pi -ne 'please review ...'`; inspect its output when the process completes.",
      "Start, answer, and revisit return a job ID immediately; do not wait or poll repeatedly. Completion is delivered automatically, and use check only when the user asks for current progress or output.",
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
            "Explicit provider/model for all members. A member-level model overrides this; omitting it uses the child Pi's configured default and never inherits the parent session model.",
        }),
      ),
      skills: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Skill names or SKILL.md paths to load for every member; automatic child skill discovery is disabled",
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
                  "Skill names or SKILL.md paths for this member; overrides team defaults and automatic discovery is disabled",
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
      thinking: Type.Optional(
        Type.Union(
          AGENT_TEAM_THINKING_LEVELS.map((level) => Type.Literal(level)),
          {
            description: "Thinking level for child Pi agents; defaults to low.",
          },
        ),
      ),
      tools: Type.Optional(
        Type.Array(StringEnum(READ_ONLY_TOOL_NAMES), {
          description:
            "Optional child-safe read-only tool allowlist. Omit for read, grep, find, and ls; an explicit empty list disables all child tools.",
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
      if (isPartial) return new Text(theme.fg("warning", "Starting agent team..."), 0, 0);
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
      _signal: AbortSignal,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<{
      content: Array<{ type: "text"; text: string }>;
      details: AgentTeamSnapshot | AgentTeamSnapshot[];
    }> {
      try {
        if (params.action === "list") {
          await refresh(ctx);
          const snapshots = summarizeAgentTeamJobs(jobs);
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
          const tools = selectTools(params.tools);
          const thinking = validateAgentTeamThinking(params.thinking);
          const timeoutMs = params.turnTimeoutMs ?? 300_000;
          const teamSkills = await resolveSkills(params.skills, ctx.cwd);
          const members: AgentTeamMemberConfig[] = [];
          for (const member of params.members) {
            const skills = await resolveSkills(member.skills ?? teamSkills, ctx.cwd);
            members.push({
              name: member.name.trim(),
              role: member.role.trim(),
              ...(member.instructionPolicy ? { instructionPolicy: member.instructionPolicy } : {}),
              ...(member.model?.trim() ? { model: member.model.trim() } : {}),
              ...(skills.length > 0 ? { skills } : {}),
            });
          }
          const config: AgentTeamConfig = {
            id,
            topic,
            mode: params.mode ?? "committee",
            interaction: params.interaction ?? "autonomous",
            members,
            maxRounds: params.maxRounds ?? 1,
            ...(params.model?.trim() ? { model: params.model.trim() } : {}),
            tools,
            thinking,
            timeoutMs,
          };

          const job = createAgentTeamJob(ctx, config, { status: "starting" });
          jobs.set(id, job);
          appendAgentTeamState(pi, job);
          updateJobStatus(ctx);
          try {
            await launchAgentTeamWorker(ctx, job, { action: "start" });
            appendAgentTeamState(pi, job);
            updateJobStatus(ctx);
            const snapshot = job.team.snapshot();
            return {
              content: [{ type: "text" as const, text: startedText(snapshot) }],
              details: snapshot,
            };
          } catch (error) {
            appendAgentTeamState(pi, job);
            throw error;
          }
        }

        if (!params.id) throw new Error(`id is required for ${params.action}`);
        const job = jobs.get(params.id);
        if (!job) throw new Error(`Unknown agent-team: ${params.id}`);

        if (params.action === "check") {
          await refresh(ctx);
          const snapshot = job.team.snapshot();
          return {
            content: [{ type: "text" as const, text: summarizeAgentTeamResult(snapshot) }],
            details: snapshot,
          };
        }

        if (params.action === "answer") {
          if (!params.answer?.trim()) throw new Error("answer is required for answer");
          await refresh(ctx);
          if (job.team.snapshot().status !== "awaiting-user") {
            throw new Error("agent-team is not waiting for user direction");
          }
          try {
            await launchAgentTeamWorker(ctx, job, { action: "answer", answer: params.answer });
            appendAgentTeamState(pi, job);
            updateJobStatus(ctx);
            const snapshot = job.team.snapshot();
            return {
              content: [{ type: "text" as const, text: startedText(snapshot) }],
              details: snapshot,
            };
          } catch (error) {
            appendAgentTeamState(pi, job);
            throw error;
          }
        }

        if (params.action === "revisit") {
          if (!params.topic?.trim()) throw new Error("topic is required for revisit");
          await refresh(ctx);
          if (job.team.snapshot().status !== "completed") {
            throw new Error("only a completed agent-team can be revisited");
          }
          try {
            await launchAgentTeamWorker(ctx, job, { action: "revisit", topic: params.topic });
            appendAgentTeamState(pi, job);
            updateJobStatus(ctx);
            const snapshot = job.team.snapshot();
            return {
              content: [{ type: "text" as const, text: startedText(snapshot) }],
              details: snapshot,
            };
          } catch (error) {
            appendAgentTeamState(pi, job);
            throw error;
          }
        }

        await refresh(ctx);
        const snapshot = await stopAgentTeamJob(ctx, job);
        appendAgentTeamState(pi, job);
        updateJobStatus(ctx);
        return {
          content: [{ type: "text" as const, text: `Stopped ${snapshot.id}` }],
          details: snapshot,
        };
      } catch (error) {
        updateJobStatus(ctx);
        throw error;
      }
    },
  });

  pi.registerMessageRenderer?.("agent-team-status", (message, { expanded }, theme) => {
    const body =
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((item) => item.type === "text")
            .map((item) => item.text ?? "")
            .join("\n");
    const details = message.details as AgentTeamSnapshot | undefined;
    let text = body;
    if (!expanded && details) {
      text = `${details.id} [${details.mode}:${details.status}] ${details.completedRounds}/${details.maxRounds} round(s)`;
      if (details.finalAnswer) text += `\n${details.finalAnswer}`;
      if (details.error) text += `\nError: ${details.error}`;
    }
    if (expanded && details) text += `\n\n${JSON.stringify(details, null, 2)}`;
    return new Text(theme.fg(details?.status === "failed" ? "error" : "toolOutput", text), 0, 0);
  });

  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    activeContext = ctx;
    restoreAgentTeamJobs(ctx, jobs);
    if (timer) clearInterval(timer);
    await refresh(ctx, true);
    timer = setInterval(() => {
      if (activeContext) void refresh(activeContext, true).catch(() => undefined);
    }, 2_000);
    timer.unref();
  });
  pi.on("session_compact", async (_event: unknown, ctx: ExtensionContext) => {
    await refresh(ctx, true);
  });
  pi.on("session_shutdown", async (_event: unknown, ctx: ExtensionContext) => {
    if (timer) clearInterval(timer);
    timer = undefined;
    await refresh(ctx);
    for (const job of jobs.values()) appendAgentTeamState(pi, job);
    jobs.clear();
    activeContext = undefined;
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}
