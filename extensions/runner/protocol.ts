import type { ProtocolContext, Supervisor } from "@halqme/protocol-supervision";
import { remainingSteps, type PlanState } from "@halqme/plan-state";
import type { LoopState } from "../loop/control.ts";

export type RunnerProposal =
  | { type: "start"; maxTurns: number }
  | { type: "progress"; steps?: readonly number[]; summary?: string }
  | { type: "finish"; evidence?: string }
  | { type: "stop"; reason: string };

export interface RunnerObservation {
  plan: PlanState;
  loop: LoopState | undefined;
}

export type RunnerProtocolContext = ProtocolContext<RunnerProposal, RunnerObservation, unknown>;

const lifecycleSupervisor: Supervisor<RunnerProtocolContext> = {
  name: "runner-lifecycle",
  evaluate({ proposal, observation }) {
    const { plan, loop } = observation;

    if (proposal.type === "start") {
      if (plan.status !== "approved")
        return { type: "block", reason: `Runner cannot start from plan status ${plan.status}.` };
      if (loop?.status === "active")
        return {
          type: "block",
          reason: `Cannot start runner while a loop is active and owned by ${loop.owner}.`,
        };
      return;
    }

    if (plan.status !== "running")
      return {
        type: "block",
        reason: `Runner cannot ${proposal.type} from plan status ${plan.status}.`,
      };
  },
};

const progressSupervisor: Supervisor<RunnerProtocolContext> = {
  name: "runner-progress",
  evaluate({ proposal, observation }) {
    if (proposal.type !== "progress") return;
    if (!proposal.steps?.length && !proposal.summary?.trim())
      return {
        type: "inject",
        context:
          "Report newly completed TODO steps and/or a concise summary of partial progress before ending the turn.",
      };

    const known = new Set(observation.plan.steps.map((step) => step.step));
    const unknown = proposal.steps?.filter((step) => !known.has(step)) ?? [];
    if (unknown.length)
      return {
        type: "block",
        reason: `Unknown plan step(s): ${unknown.join(", ")}.`,
      };
  },
};

const completionSupervisor: Supervisor<RunnerProtocolContext> = {
  name: "runner-completion",
  evaluate({ proposal, observation }) {
    if (proposal.type !== "finish") return;

    const remaining = remainingSteps(observation.plan);
    if (remaining.length)
      return {
        type: "inject",
        context: [
          "Completion is not admissible yet. Continue the protocol with the remaining TODO steps:",
          ...remaining.map((step) => `${step.step}. ${step.text}`),
        ].join("\n"),
      };

    if (!proposal.evidence?.trim())
      return {
        type: "inject",
        context:
          "All TODO steps are reported complete, but an empty checklist is not a completion verdict. Verify the requested outcome and provide concise evidence with runner.finish.",
      };
  },
};

export const runnerSupervisors: readonly Supervisor<RunnerProtocolContext>[] = [
  lifecycleSupervisor,
  progressSupervisor,
  completionSupervisor,
];
