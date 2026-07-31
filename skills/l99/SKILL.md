---
name: l99
description: Apply a maximum-effort quality policy to complex or high-stakes work by deepening investigation, verification, adversarial review, and handoff without replacing domain or safety skills.
---

# L99

Use this skill as an overlay when the user explicitly requests maximum effort, or when the task's complexity, risk, uncertainty, or impact warrants substantially more investigation and verification than usual. It applies across implementation, diagnosis, research, review, and other work. Do not use it to justify unnecessary scope or activity on a simple task.

## Workflow

1. Define the target, success criteria, constraints, affected surface, and risks. Record assumptions and identify decisions that require user approval.
2. Investigate broadly enough to establish the relevant context: source code, configuration, tests, documentation, dependencies, history, logs, and adjacent usage. Prefer evidence over intuition and distinguish facts from inferences.
3. Build an explicit plan and compose with the applicable domain skills. Select the smallest coherent change and state what will not be changed.
4. Implement or execute the change in small, reviewable steps. Preserve existing interfaces, validation, error handling, and safety boundaries unless the task requires otherwise.
5. Verify progressively: run the narrowest relevant checks first, then broaden to integration or full checks in proportion to risk. Inspect warnings, skipped checks, and complete failures.
6. Perform an adversarial self-review. Challenge boundary conditions, invalid inputs, failure paths, compatibility assumptions, security or data-loss risks, and a plausible counterexample to the acceptance criteria. Add durable regression coverage when practical.
7. Review the final diff or output for accidental scope, stale documentation, secrets, missing verification, and unclear handoff. Report evidence, remaining uncertainty, skipped checks, and follow-up risks.

## Composition and boundaries

- L99 is a quality and effort policy, not a replacement for `implement-change`, `diagnose-problem`, `verify-work`, `review-change`, `research-answer`, or other domain skills. Use those skills when their domain applies.
- `operate-safely` and explicit approval requirements remain authoritative. Maximum effort never authorizes destructive, privileged, externally visible, or irreversible actions without the required confirmation.
- Do not require a fixed number of tool calls, a fixed token budget, or every available tool. Effort is justified by evidence, risk, and verification coverage.
- Stop and ask when a material decision cannot be resolved from evidence and would change scope, behavior, dependencies, trust boundaries, or external state.

## Completion criteria

Do not claim maximum effort merely because many steps were performed. Complete only when the target and acceptance criteria are addressed, relevant evidence has been inspected, verification is proportionate to risk, and remaining uncertainty is explicitly reported.
