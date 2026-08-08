export type MaybePromise<T> = T | Promise<T>;

export type SupervisionDecision =
  | { type: "allow" }
  | { type: "block"; reason: string }
  | { type: "inject"; context: string };

export interface ProtocolContext<Proposal, Observation, Trace = unknown> {
  proposal: Proposal;
  observation: Observation;
  trace: readonly Trace[];
}

export interface Supervisor<Context> {
  name: string;
  evaluate(context: Context): MaybePromise<SupervisionDecision | undefined>;
}

export interface SupervisionRecord {
  supervisor: string;
  decision: SupervisionDecision;
}

export interface SupervisionResult {
  decision: SupervisionDecision;
  records: readonly SupervisionRecord[];
}

const ALLOW: SupervisionDecision = { type: "allow" };

export async function supervise<Context>(
  context: Context,
  supervisors: readonly Supervisor<Context>[],
): Promise<SupervisionResult> {
  const records: SupervisionRecord[] = [];

  for (const supervisor of supervisors) {
    const decision = await supervisor.evaluate(context);
    if (!decision) continue;
    records.push({ supervisor: supervisor.name, decision });
    if (decision.type !== "allow") return { decision, records };
  }

  return { decision: ALLOW, records };
}
