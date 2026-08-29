---
name: diagnose-problem
description: Diagnose failures, regressions, anomalies, flaky behavior, performance problems, or unexpected results. Use when a causal explanation must be established from observable evidence.
---

# Diagnose a Problem

1. Define observed behavior, expected behavior, environment, impact, and the earliest known failure. Keep observations separate from explanations.
2. Acquire the smallest relevant repository and runtime evidence. Use `context` to locate the responsible boundary instead of broadly reading the repository.
3. Reproduce the problem with the smallest faithful check when safe. Record what the result proves and what it leaves unresolved.
4. Maintain only genuinely competing hypotheses. Choose the next observation by information value: prefer the check whose possible outcomes most clearly distinguish the leading explanations.
5. Record material shifts in understanding with `task.checkpoint` when a task is active. Do not preserve rejected hypotheses as implementation requirements.
6. Trace the failure from symptom to trigger to responsible boundary and causal mechanism. Challenge the leading explanation with the strongest plausible alternative before declaring root cause.
7. If the user requested diagnosis only, stop before mutation and report the smallest supported fix plus verification path.
8. If a fix is requested, use the normal implementation path: `context` -> `code` or ordinary edit -> project checks -> `verify`. Confirm the original failure and relevant neighboring behavior.
9. Report confirmed findings, eliminated explanations, checks run, remaining uncertainty, and any approval boundary that prevents the next observation.

For intermittent failures, vary one factor at a time and preserve versions, timestamps, seeds, inputs, and environment details needed to reproduce the result.
