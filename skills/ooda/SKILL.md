---
name: ooda
description: Control uncertain investigation and decision-making through repeated Observe, Orient, Decide, and Act cycles with explicit competing hypotheses and falsifiable experiments.
---

# OODA

Use this skill when the cause of a failure, the state of a system, or the right decision is materially uncertain and progress depends on iterative evidence gathering. Compose it with `diagnose-problem` or another domain skill when applicable. Do not use it as a slower wrapper for a simple, well-understood task.

## Cycle

### Observe

Record only confirmed observations: the user's report, current state, reproducible behavior, logs, code, configuration, test results, and command outcomes. Include provenance and timestamps when they matter. Keep observations separate from explanations.

### Orient

Build a model from the observations and state its uncertainty. Present at least two genuinely competing hypotheses when the cause or decision is uncertain. For each hypothesis, list supporting evidence, contradicting evidence, assumptions, and the observation that would most distinguish it. Do not manufacture alternatives when the evidence already establishes the cause.

### Decide

Choose the smallest, safest, most reversible action that is expected to provide useful information or move the task forward. Prefer a falsifiable experiment with a clear predicted result over broad changes. State the hypothesis being tested, the procedure, expected outcomes, stop conditions, and what will be changed if the result supports or rejects it.

### Act

Execute only the selected action, respecting `operate-safely` and any approval boundary. Record the actual result, including failures and unexpected output. Update the hypotheses explicitly: supported, weakened, rejected, or still unresolved. If uncertainty remains, begin the next Observe cycle from the new state rather than repeating the same experiment.

## Exit conditions

Stop and report when the cause or decision is sufficiently supported, when additional experiments have little expected information value, when required access or evidence is unavailable, or when the next action would be destructive, privileged, externally visible, or irreversible without approval. Report unresolved hypotheses, evidence gaps, and the safest next step.

## Boundaries

- OODA is a control loop, not a substitute for domain procedures, verification, or safety rules.
- Never present an inference as an observation, and never treat an experiment's result as proof beyond what it actually distinguishes.
- Do not impose a fixed number of cycles. Continue while the loop produces meaningful progress and stop when an exit condition is reached.
