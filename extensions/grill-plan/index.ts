import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { Type, type AssistantMessage, type TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  extractPlanSteps,
  extractPlanText,
  filterTransientContextMessages,
  isSafeReadOnlyCommand,
  markCompletedStepNumbers,
  markCompletedSteps,
  parsePlanSidecar,
  planMarkdownFilename,
  planSidecarFilename,
  planSidecarMarkdown,
  type PlanPhase,
  type PlanSidecar,
  type PlanStep,
} from "./utils.ts";

interface PersistedState {
  phase: PlanPhase;
  goal?: string;
  planText?: string;
  steps?: PlanStep[];
  toolsBeforePlanning?: string[];
}

const STATE_ENTRY = "grill-plan-state";
const PROGRESS_TOOL = "grill_plan";
const PLAN_TOOLS = new Set([
  "read",
  "bash",
  "grep",
  "find",
  "ls",
  "questionnaire",
  "web_search",
  "web_fetch",
  "syntax_search",
  "syntax_inspect",
  "grill_plan",
]);

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === "assistant" && Array.isArray(message.content);
}

function textOf(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export default function grillPlanExtension(pi: ExtensionAPI): void {
  let phase: PlanPhase = "idle";
  let goal: string | undefined;
  let planText: string | undefined;
  let steps: PlanStep[] = [];
  let sidecarPath: string | undefined;
  let toolsBeforePlanning: string[] | undefined;

  pi.registerFlag("plan", {
    description: "Start in Grill Plan mode",
    type: "boolean",
    default: false,
  });

  async function writeSidecar(ctx: ExtensionContext): Promise<string | undefined> {
    if (!ctx.sessionManager.getSessionFile()) return undefined;
    const sessionId = ctx.sessionManager.getSessionId();
    const path = join(ctx.sessionManager.getSessionDir(), planSidecarFilename(sessionId));
    const snapshot: PlanSidecar = {
      version: 1,
      sourceSessionId: sessionId,
      cwd: ctx.cwd,
      updatedAt: new Date().toISOString(),
      phase,
      ...(goal === undefined ? {} : { goal }),
      ...(planText === undefined ? {} : { planText }),
      steps,
    };
    const temporaryPath = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, path);

    parsePlanSidecar(JSON.parse(await readFile(path, "utf8")) as unknown);

    const markdownPath = join(ctx.sessionManager.getSessionDir(), planMarkdownFilename(sessionId));
    const markdownTemporaryPath = `${markdownPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(markdownTemporaryPath, planSidecarMarkdown(snapshot), {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(markdownTemporaryPath, markdownPath);
    } catch (error) {
      ctx.ui.notify(`Could not update Grill Plan Markdown sidecar: ${String(error)}`, "error");
    }
    return path;
  }

  async function persist(ctx: ExtensionContext): Promise<string | undefined> {
    try {
      sidecarPath = await writeSidecar(ctx);
      pi.appendEntry(STATE_ENTRY, { phase, goal, planText, steps, toolsBeforePlanning });
      updateUi(ctx);
      return sidecarPath;
    } catch (error) {
      ctx.ui.notify(`Could not update Grill Plan sidecar: ${String(error)}`, "error");
      return undefined;
    }
  }

  function enableReadOnlyTools(): void {
    if (toolsBeforePlanning === undefined) toolsBeforePlanning = pi.getActiveTools();
    const available = new Set(pi.getAllTools().map((tool) => tool.name));
    pi.setActiveTools(unique([...PLAN_TOOLS].filter((name) => available.has(name))));
  }

  function restoreTools(): void {
    if (toolsBeforePlanning) pi.setActiveTools(toolsBeforePlanning);
    toolsBeforePlanning = undefined;
  }

  function updateUi(ctx: ExtensionContext): void {
    const markdownPath = sidecarPath?.replace(/\.json$/, ".md");
    const sidecarLabel = markdownPath ? ` · ${markdownPath}` : "";
    if (phase === "planning") {
      ctx.ui.setStatus("grill-plan", ctx.ui.theme.fg("warning", `plan: grilling${sidecarLabel}`));
    } else if (phase === "ready") {
      ctx.ui.setStatus("grill-plan", ctx.ui.theme.fg("accent", `plan: ready${sidecarLabel}`));
    } else if (phase === "executing") {
      const complete = steps.filter((step) => step.completed).length;
      ctx.ui.setStatus(
        "grill-plan",
        ctx.ui.theme.fg("accent", `plan: ${complete}/${steps.length}${sidecarLabel}`),
      );
    } else {
      ctx.ui.setStatus("grill-plan", undefined);
    }

    if ((phase === "ready" || phase === "executing") && planText && steps.length > 0) {
      const planLines = planText.split("\n");
      const stepLines = steps.map((step) =>
        step.completed
          ? `${ctx.ui.theme.fg("success", "✓")} ${ctx.ui.theme.fg("muted", step.text)}`
          : `${ctx.ui.theme.fg("muted", "○")} ${step.text}`,
      );
      ctx.ui.setWidget("grill-plan-steps", [...planLines, "", ...stepLines]);
    } else {
      ctx.ui.setWidget("grill-plan-steps", undefined);
    }
  }

  function setProgressToolEnabled(enabled: boolean): void {
    const active = pi.getActiveTools().filter((name) => name !== PROGRESS_TOOL);
    pi.setActiveTools(enabled ? [...active, PROGRESS_TOOL] : active);
  }

  async function finishExecutionIfComplete(ctx: ExtensionContext): Promise<boolean> {
    if (phase !== "executing" || steps.length === 0 || !steps.every((step) => step.completed)) {
      return false;
    }
    phase = "idle";
    setProgressToolEnabled(false);
    updateUi(ctx);
    await persist(ctx);
    ctx.ui.notify("Approved plan completed.", "info");
    return true;
  }

  async function commitPlan(
    nextPlanText: string,
    nextSteps: PlanStep[],
    ctx: ExtensionContext,
  ): Promise<boolean> {
    planText = nextPlanText;
    steps = nextSteps;
    phase = "ready";
    enableReadOnlyTools();
    updateUi(ctx);
    const savedPath = await persist(ctx);
    if (ctx.sessionManager.getSessionFile() && !savedPath) {
      phase = "planning";
      planText = undefined;
      steps = [];
      updateUi(ctx);
      await persist(ctx);
      ctx.ui.notify(
        "Could not verify the Grill Plan sidecar; the plan remains in planning mode.",
        "error",
      );
      return false;
    }
    return true;
  }

  pi.registerTool({
    name: "grill_plan",
    label: "Grill Plan",
    description:
      "Manage the approval-gated Grill Plan lifecycle. Use start for read-only planning, write for a completed structured plan, progress after verified execution steps, and status or cancel as needed.",
    promptSnippet: "Manage a read-only plan, persist it, or record approved-plan progress",
    promptGuidelines: [
      "Use action=start before investigating a complex or high-risk task.",
      "Use action=write when the final structured plan is complete. The extension also saves a valid plan automatically at agent end.",
      "Use action=progress immediately after completing and verifying an approved step.",
      "Do not claim a plan is executable until action=write succeeds or the extension reports that it was saved.",
    ],
    parameters: Type.Union([
      Type.Object({
        action: Type.Literal("start"),
        goal: Type.Optional(Type.String({ description: "The task to plan, if already stated" })),
      }),
      Type.Object({
        action: Type.Literal("write"),
        issue: Type.String({ minLength: 1 }),
        cause: Type.String({ minLength: 1 }),
        changes: Type.String({ minLength: 1 }),
        approach: Type.String({ minLength: 1 }),
        files: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
        steps: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
      }),
      Type.Object({
        action: Type.Literal("progress"),
        completedSteps: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1 }),
      }),
      Type.Object({ action: Type.Literal("status") }),
      Type.Object({ action: Type.Literal("cancel") }),
    ]),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.action === "start") {
        if (phase !== "idle")
          return {
            content: [{ type: "text" as const, text: `Grill Plan is already ${phase}.` }],
            details: { phase },
            isError: true,
          };
        if (!ctx.hasUI)
          return {
            content: [
              { type: "text" as const, text: "Grill Plan requires interactive user confirmation." },
            ],
            details: { phase },
            isError: true,
          };
        const goalText = params.goal?.trim() || "the current task";
        const approved = await ctx.ui.confirm(
          "Start Grill Plan?",
          `Switch to read-only planning for ${goalText}. Implementation will require explicit approval.`,
        );
        if (!approved)
          return {
            content: [{ type: "text" as const, text: "User declined to start Grill Plan." }],
            details: { phase: "idle", approved: false },
          };
        await beginPlanning(ctx, params.goal);
        return {
          content: [{ type: "text" as const, text: "Grill Plan started in read-only mode." }],
          details: { phase: "planning", approved: true },
        };
      }

      if (params.action === "write") {
        if (phase !== "planning")
          return {
            content: [
              { type: "text" as const, text: `Cannot write a plan while Grill Plan is ${phase}.` },
            ],
            details: { phase },
            isError: true,
          };
        const cleanSteps = params.steps.map((step) => step.replace(/\s+/g, " ").trim());
        if (cleanSteps.some((step) => step.length < 4))
          return {
            content: [
              {
                type: "text" as const,
                text: "Every plan step must contain at least four characters.",
              },
            ],
            details: { phase },
            isError: true,
          };
        const structuredPlan = [
          `課題:\n${params.issue.trim()}`,
          `原因:\n${params.cause.trim()}`,
          `修正するべき点:\n${params.changes.trim()}`,
          `対処法:\n${params.approach.trim()}`,
          `実際に編集するファイル:\n${params.files.map((file) => `- ${file.trim()}`).join("\n")}`,
          `Plan:\n${cleanSteps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
        ].join("\n\n");
        const saved = await commitPlan(
          structuredPlan,
          cleanSteps.map((text, index) => ({ step: index + 1, text, completed: false })),
          ctx,
        );
        if (!saved)
          return {
            content: [
              { type: "text" as const, text: "Plan was not saved and remains in planning mode." },
            ],
            details: { phase },
            isError: true,
          };
        ctx.ui.notify(
          "Executable Grill Plan saved and verified. Approve it with /plan execute (or /plan do).",
          "info",
        );
        return {
          content: [{ type: "text" as const, text: "Executable Grill Plan saved and verified." }],
          details: { phase, steps: steps.length },
        };
      }

      if (params.action === "progress") {
        if (phase !== "executing")
          return {
            content: [{ type: "text" as const, text: "No approved Grill Plan is executing." }],
            details: { completedSteps: [], changed: 0, complete: 0, total: steps.length },
            isError: true,
          };
        const requested = unique(params.completedSteps);
        const unknown = requested.filter((number) => !steps.some((step) => step.step === number));
        if (unknown.length > 0)
          return {
            content: [
              { type: "text" as const, text: `Unknown Grill Plan steps: ${unknown.join(", ")}` },
            ],
            details: {
              completedSteps: requested,
              changed: 0,
              complete: steps.filter((step) => step.completed).length,
              total: steps.length,
            },
            isError: true,
          };
        const changed = markCompletedStepNumbers(requested, steps);
        updateUi(ctx);
        const completed = await finishExecutionIfComplete(ctx);
        if (!completed) await persist(ctx);
        const complete = steps.filter((step) => step.completed).length;
        return {
          content: [
            {
              type: "text" as const,
              text:
                changed > 0
                  ? `Recorded progress: ${complete}/${steps.length}`
                  : "Progress was already recorded.",
            },
          ],
          details: { completedSteps: requested, changed, complete, total: steps.length },
        };
      }

      if (params.action === "cancel") {
        await cancel(ctx);
        return {
          content: [{ type: "text" as const, text: "Grill Plan cancelled." }],
          details: { phase },
        };
      }

      if (params.action === "status") {
        const complete = steps.filter((step) => step.completed).length;
        return {
          content: [
            {
              type: "text" as const,
              text: `Phase: ${phase}\nProgress: ${complete}/${steps.length}\nPlan file: ${sidecarPath ?? "(not saved)"}`,
            },
          ],
          details: { phase, complete, total: steps.length, sidecarPath },
        };
      }

      return {
        content: [{ type: "text" as const, text: "Unknown Grill Plan action." }],
        details: { phase },
        isError: true,
      };
    },
  });

  async function beginPlanning(ctx: ExtensionContext, requestedGoal?: string): Promise<void> {
    setProgressToolEnabled(false);
    phase = "planning";
    goal = requestedGoal?.trim() || undefined;
    planText = undefined;
    steps = [];
    enableReadOnlyTools();
    updateUi(ctx);
    await persist(ctx);
    ctx.ui.notify("Grill Plan mode enabled. Writes are disabled until plan approval.", "info");
  }

  async function cancel(ctx: ExtensionContext): Promise<void> {
    phase = "idle";
    goal = undefined;
    planText = undefined;
    steps = [];
    setProgressToolEnabled(false);
    restoreTools();
    updateUi(ctx);
    await persist(ctx);
    ctx.ui.notify("Grill Plan mode cancelled.", "info");
  }

  async function beginExecution(ctx: ExtensionContext): Promise<boolean> {
    if (phase === "executing") {
      if (await finishExecutionIfComplete(ctx)) return false;
      setProgressToolEnabled(true);
      pi.sendUserMessage("Resume the approved plan from the first remaining step.", {
        deliverAs: "followUp",
      });
      return true;
    }
    if (phase !== "ready" || !planText || steps.length === 0) {
      ctx.ui.notify("No executable plan is ready.", "warning");
      return false;
    }
    phase = "executing";
    restoreTools();
    setProgressToolEnabled(true);
    updateUi(ctx);
    await persist(ctx);

    pi.sendUserMessage("Execute the approved plan now. Start with the first remaining step.", {
      deliverAs: "followUp",
    });
    return true;
  }

  async function refinePlan(feedback: string, ctx: ExtensionContext): Promise<void> {
    if (phase !== "ready" || !planText || steps.length === 0) {
      ctx.ui.notify("No completed plan is ready to refine.", "warning");
      return;
    }
    let refinement = feedback.trim();
    if (!refinement && ctx.hasUI) {
      refinement =
        (await ctx.ui.editor("How should the plan change?", planText ?? ""))?.trim() ?? "";
    }
    if (!refinement) return;

    phase = "planning";
    planText = undefined;
    steps = [];
    enableReadOnlyTools();
    updateUi(ctx);
    await persist(ctx);
    pi.sendUserMessage(`Refine the plan using this feedback:\n\n${refinement}`, {
      deliverAs: "followUp",
    });
  }

  async function readSidecar(ctx: ExtensionContext, sessionId: string): Promise<PlanSidecar> {
    const path = join(ctx.sessionManager.getSessionDir(), planSidecarFilename(sessionId));
    const snapshot = parsePlanSidecar(JSON.parse(await readFile(path, "utf8")) as unknown);
    if (snapshot.sourceSessionId !== sessionId) {
      throw new Error("Plan sidecar session ID does not match its filename");
    }
    if (snapshot.cwd !== ctx.cwd) {
      throw new Error(`Plan sidecar belongs to a different working directory: ${snapshot.cwd}`);
    }
    if (snapshot.phase === "idle") throw new Error("The selected session has no active plan");
    if (
      (snapshot.phase === "ready" || snapshot.phase === "executing") &&
      (!snapshot.planText || snapshot.steps.length === 0)
    ) {
      throw new Error("Plan sidecar is missing its executable plan");
    }
    return snapshot;
  }

  async function selectSidecar(ctx: ExtensionContext): Promise<PlanSidecar | undefined> {
    const currentSessionId = ctx.sessionManager.getSessionId();
    const filenames = (await readdir(ctx.sessionManager.getSessionDir())).filter(
      (name) => name.endsWith(".grill-plan.json") && name !== planSidecarFilename(currentSessionId),
    );
    const candidates: PlanSidecar[] = [];
    for (const filename of filenames) {
      const sessionId = filename.slice(0, -".grill-plan.json".length);
      try {
        const snapshot = await readSidecar(ctx, sessionId);
        candidates.push(snapshot);
      } catch {
        // Invalid, idle, and other-cwd sidecars are not restorable choices.
      }
    }
    candidates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    if (candidates.length === 0) {
      ctx.ui.notify("No restorable Grill Plan sidecars were found.", "warning");
      return undefined;
    }
    const labels = candidates.map((snapshot) => {
      const label = snapshot.goal?.replace(/\s+/g, " ").trim() || snapshot.phase;
      return `${snapshot.updatedAt} | ${label} | ${snapshot.sourceSessionId}`;
    });
    const selected = await ctx.ui.select("Restore Grill Plan", labels);
    const index = selected === undefined ? -1 : labels.indexOf(selected);
    return index < 0 ? undefined : candidates[index];
  }

  async function restoreSidecar(args: string, ctx: ExtensionContext): Promise<void> {
    let snapshot: PlanSidecar | undefined;
    const sessionId = args.trim();
    try {
      if (sessionId) {
        snapshot = await readSidecar(ctx, sessionId);
      } else if (ctx.hasUI) {
        snapshot = await selectSidecar(ctx);
      } else {
        ctx.ui.notify("Usage: /plan-restore <session-id>", "warning");
        return;
      }
    } catch (error) {
      ctx.ui.notify(`Could not restore Grill Plan: ${String(error)}`, "error");
      return;
    }
    if (!snapshot) return;

    setProgressToolEnabled(false);
    restoreTools();
    phase = snapshot.phase;
    goal = snapshot.goal;
    planText = snapshot.planText;
    steps = snapshot.steps.map((step) => ({ ...step }));
    if (phase === "planning" || phase === "ready") enableReadOnlyTools();
    else if (phase === "executing") setProgressToolEnabled(true);
    updateUi(ctx);
    await persist(ctx);
    ctx.ui.notify(`Restored Grill Plan from ${snapshot.sourceSessionId}.`, "info");
    if (phase === "planning") {
      pi.sendUserMessage("Continue planning from the restored Grill Plan context.", {
        deliverAs: "followUp",
      });
    } else if (phase === "executing") {
      pi.sendUserMessage("Resume the restored approved plan from the first remaining step.", {
        deliverAs: "followUp",
      });
    }
  }

  pi.registerCommand("plan", {
    description: "Create or manage a Grill Plan",
    handler: async (args, ctx) => {
      const trimmed = args.trim();
      const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
      const subcommand = match?.[1]?.toLowerCase();
      const subargs = match?.[2] ?? "";

      switch (subcommand) {
        case undefined:
          await beginPlanning(ctx);
          return;
        case "execute":
        case "do":
          await beginExecution(ctx);
          return;
        case "restore":
          await restoreSidecar(subargs, ctx);
          return;
        case "refine":
        case "fix":
          await refinePlan(subargs, ctx);
          return;
        case "status": {
          const complete = steps.filter((step) => step.completed).length;
          ctx.ui.notify(
            `Phase: ${phase}\nGoal: ${goal ?? "(none)"}\nProgress: ${complete}/${steps.length}\nPlan file: ${sidecarPath ?? "(not saved)"}`,
            "info",
          );
          return;
        }
        case "cancel":
          await cancel(ctx);
          return;
        default:
          await beginPlanning(ctx, trimmed);
          pi.sendUserMessage(trimmed, { deliverAs: "followUp" });
      }
    },
  });

  pi.on("tool_call", async (event) => {
    if (phase !== "planning" && phase !== "ready") return;
    if (!PLAN_TOOLS.has(event.toolName)) {
      return { block: true, reason: `Grill Plan mode does not allow the ${event.toolName} tool.` };
    }
    if (event.toolName === "bash") {
      const command = (event.input as { command?: unknown }).command;
      if (typeof command !== "string" || !isSafeReadOnlyCommand(command)) {
        return {
          block: true,
          reason: `Grill Plan mode blocked a non-allowlisted shell command: ${String(command)}`,
        };
      }
    }
  });

  pi.on("context", async (event) => {
    return {
      messages: filterTransientContextMessages(
        event.messages as (AgentMessage & { customType?: string })[],
      ),
    };
  });

  pi.on("before_agent_start", async (event) => {
    if (phase === "planning" || phase === "ready") {
      const stateInstruction =
        phase === "ready"
          ? "A complete plan is awaiting explicit approval. Do not implement it. Approval exists only after /plan execute, /plan do, or an explicit UI selection; do not infer approval from a repeated task, plan text, or an assistant-generated follow-up. If the user requests changes, revise the plan while remaining read-only."
          : "You are investigating and planning. Even after identifying the cause or fix, do not proceed to editing or implementation.";
      const instructions = `[GRILL PLAN MODE: READ ONLY]\n\n${stateInstruction}\nDo not edit files, mutate repository state, install dependencies, or perform external side effects. Read-only exploration, searches, diagnostics, tests, and builds are allowed only when they improve the plan without changing repository-tracked files.\n\nWork conversationally through these phases in order:\n\n1. Ground in the environment\n- Inspect the actual repository, source-of-truth documents, current diffs, configuration, entrypoints, schemas, and tests before asking questions.\n- Resolve discoverable facts yourself. Before the first question, perform at least one targeted read-only exploration pass unless the user's prompt is internally contradictory or no local environment is available.\n- Treat memory as orientation, not authority.\n\n2. Resolve intent\n- Establish the goal and observable success criteria, audience, in-scope and out-of-scope behavior, constraints, current state, and consequential preferences or tradeoffs.\n- Ask only questions whose answers materially change the plan, confirm an important assumption, or provide information that cannot be discovered locally.\n- Prefer the questionnaire tool. Usually ask one focused question; ask at most three related questions together when that is materially more efficient. Put the recommended option first and explain its tradeoff briefly.\n- For low-impact, reversible choices, choose a sensible default and disclose it instead of prolonging the interview.\n\n3. Resolve implementation\n- Make the approach decision-complete: affected behavior and components, interfaces and I/O, data flow, edge and failure cases, compatibility, security and performance constraints, tests and acceptance criteria, rollout or migration needs, and verification.\n- Challenge contradictions, hidden assumptions, scope creep, and the strongest opposing design when they could change the result.\n- Do not ask the user to choose details that repository evidence or established conventions already decide.\n\nOnly when no material decision remains, produce one self-contained plan that another agent can execute without making further decisions. Keep it concise but implementation-safe. It must use these exact sections in this order:\n\n課題:\nState the observed problem, scope, and desired outcome in plain language.\n\n原因:\nState the evidence-backed root cause or, for new work, the gap creating the need. Separate confirmed facts from remaining bounded uncertainty.\n\n修正するべき点:\nList the behaviors, contracts, or components that must change.\n\n対処法:\nDescribe the chosen approach, important interfaces, constraints, and failure handling.\n\n実際に編集するファイル:\nList concrete repository-relative file paths and the purpose of each edit. Use "なし（調査のみ）" only when no edit is intended.\n\nPlan:\n1. Grouped implementation step tied to the sections above\n2. Tests and verification tied to acceptance criteria\n\nDo not emit the final structured plan while any material question remains. Do not continue from the Plan section into implementation without explicit approval.`;
      return {
        systemPrompt: `${event.systemPrompt}\n\n${instructions}`,
      };
    }

    if (phase === "executing" && steps.length > 0) {
      const remaining = steps
        .filter((step) => !step.completed)
        .map((step) => `${step.step}. ${step.text}`)
        .join("\n");
      return {
        systemPrompt: `${event.systemPrompt}\n\n[EXECUTING APPROVED PLAN]\n\n${planText ?? ""}\n\nRemaining steps:\n${remaining}\n\nFollow the approved plan. Immediately after completing and verifying a step, call ${PROGRESS_TOOL} with action \`progress\` and its step number before continuing. The legacy [DONE:n] marker is only a fallback. Do not claim completion while any step remains unrecorded. If evidence invalidates the plan or new authority is needed, stop and explain rather than silently changing scope.`,
      };
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    if (phase !== "executing" || !isAssistantMessage(event.message)) return;
    if (markCompletedSteps(textOf(event.message), steps) > 0) {
      updateUi(ctx);
    }
    if (await finishExecutionIfComplete(ctx)) return;
    await persist(ctx);
  });

  pi.on("agent_end", async (event, ctx) => {
    if (phase === "executing") {
      if (await finishExecutionIfComplete(ctx)) return;

      const remaining = steps
        .filter((step) => !step.completed)
        .map((step) => `${step.step}. ${step.text}`)
        .join("\n");
      pi.sendUserMessage(
        `Continue the approved plan from the first remaining step.\n\nRemaining steps:\n${remaining}\n\nDo not stop between steps: complete and verify each step, record it with ${PROGRESS_TOOL}, then continue. Stop only if the plan is invalidated or explicit user authority is required.`,
        { deliverAs: "followUp" },
      );
      return;
    }
    if (phase !== "planning" && phase !== "ready") return;

    const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
    if (!lastAssistant) return;
    const response = textOf(lastAssistant);
    const extractedSteps = extractPlanSteps(response);
    const extractedPlan = extractPlanText(response);
    if (!extractedPlan || extractedSteps.length === 0) return;

    const saved = await commitPlan(extractedPlan, extractedSteps, ctx);
    if (!saved || !ctx.hasUI) return;
    const choice = await ctx.ui.select("Plan ready", [
      "Approve and execute",
      "Refine the plan",
      "Continue grilling",
    ]);
    if (choice === "Approve and execute") {
      await beginExecution(ctx);
    } else if (choice === "Refine the plan") {
      await refinePlan("", ctx);
    } else if (choice === "Continue grilling") {
      phase = "planning";
      planText = undefined;
      steps = [];
      enableReadOnlyTools();
      updateUi(ctx);
      await persist(ctx);
      pi.sendUserMessage(
        "Continue planning. Resolve the most consequential remaining uncertainty; ask one focused question, or at most three related material questions when that is more efficient.",
        {
          deliverAs: "followUp",
        },
      );
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    const startInPlanMode = pi.getFlag("plan") === true;
    const latest = ctx.sessionManager
      .getEntries()
      .filter(
        (entry: { type: string; customType?: string }) =>
          entry.type === "custom" && entry.customType === STATE_ENTRY,
      )
      .pop() as { data?: PersistedState } | undefined;

    if (latest?.data) {
      phase = latest.data.phase ?? phase;
      goal = latest.data.goal;
      planText = latest.data.planText;
      steps = latest.data.steps ?? [];
      toolsBeforePlanning = latest.data.toolsBeforePlanning?.filter(
        (name) => name !== PROGRESS_TOOL,
      );
    }
    if (startInPlanMode) {
      phase = "planning";
      planText = undefined;
      steps = [];
    }
    if (phase === "planning" || phase === "ready") enableReadOnlyTools();
    else if (phase === "executing") setProgressToolEnabled(true);
    else setProgressToolEnabled(false);
    updateUi(ctx);
    if (startInPlanMode) await persist(ctx);
  });
}
