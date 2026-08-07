import type { TurnObservation } from "../observation.ts";

export function buildTurnBoundaryPrompt(observation: TurnObservation): string | undefined {
  if (observation.failures === 0 && observation.mutations === 0) return undefined;

  const reminders: string[] = [];
  if (observation.failures > 0) {
    const failed = [...new Set(observation.failedTools)].join(", ");
    reminders.push(
      `A tool or check failed${failed ? ` (${failed})` : ""}. Treat the failure as evidence: identify the causal mechanism before compensating with more code or abstraction, and distinguish environment/tool failure from product failure.`,
    );
  }

  if (observation.mutations > 0)
    reminders.push(
      "Project state changed. Re-read the affected behavior and resulting diff before continuing; remove incidental complexity, reuse existing mechanisms, and do not broaden scope beyond the requested outcome.",
    );

  if (observation.mutations >= 3)
    reminders.push(
      "Several mutation operations accumulated in one turn. Reassess whether every changed surface is necessary before adding another one.",
    );

  if (observation.mutations > 0 && observation.verifications > 0 && observation.failures === 0)
    reminders.push(
      "Checks passed, but passing checks are evidence rather than semantic completion. Compare the actual outcome with the request and account for any unverified acceptance criteria before declaring done.",
    );

  return [
    "<inception-reminder>",
    ...reminders.map((reminder) => `- ${reminder}`),
    "Use this as internal judgment; do not recite it to the user.",
    "</inception-reminder>",
  ].join("\n");
}
