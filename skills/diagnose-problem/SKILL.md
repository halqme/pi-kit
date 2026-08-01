---
name: diagnose-problem
description: Diagnose failures, regressions, anomalies, flaky behavior, performance problems, or unexpected results. Use when the user asks why something is broken, requests root-cause analysis, provides an error or failing check, or asks Pi to debug an issue. Do not use for speculative redesign without an observed problem.
---

# Diagnose a Problem

1. Define the observed behavior, expected behavior, impact, environment, and earliest known failure. Record only confirmed observations, with provenance and timestamps when they matter, and keep observations separate from explanations.
2. Inspect applicable instructions, current changes, relevant code and configuration, complete errors or logs, and recent history when available.
3. Reproduce the problem with the smallest faithful command or artifact when safe and practical. Record what the reproduction proves and what it does not prove.
4. Orient the evidence into a short, ranked set of genuinely competing hypotheses. For each hypothesis, list supporting and contradicting evidence, assumptions, and the observation that would most distinguish it. Do not manufacture alternatives when the cause is already established.
5. Decide on the smallest, safest, most reversible check that can distinguish the hypotheses or move the diagnosis forward. State the hypothesis being tested, procedure, expected outcomes, and stop condition; do not make a broad edit merely to test an explanation.
6. Act only on the selected check, respecting `operate-safely` and any approval boundary. Record the actual result, including failures and unexpected output, then mark each hypothesis supported, weakened, rejected, or unresolved. If uncertainty remains, start the next observation from the new evidence rather than repeating an unchanged check.
7. Trace the failure to the responsible boundary and explain the causal mechanism with concrete evidence. Distinguish root cause from trigger and symptom.
8. Adversarially challenge the leading diagnosis with the strongest competing explanation and run the check that best distinguishes it. Confirm that the proposed cause predicts the observed behavior better than correlation alone.
9. If the user requested diagnosis only, stop before editing and recommend the smallest viable fix plus a verification plan.
10. If the user requested a fix, apply the `implement-change` workflow, add or run a regression check, and verify both the original failure and relevant neighboring behavior.
11. Report confirmed findings, evidence, eliminated hypotheses, actual checks and results, unresolved uncertainty, and next steps. Stop when the cause is sufficiently supported, additional checks have little information value, required evidence is unavailable, or the next action needs approval.

For intermittent issues, vary one factor at a time and preserve timestamps, seeds, versions, inputs, and environment details needed to reproduce the result.

## Trigger and contract

Use when an observed failure, regression, anomaly, or unexpected result needs a causal explanation. Do not use for speculative redesign or a fix without an observed problem. Input is the reported behavior and available evidence; output is a ranked, evidence-backed diagnosis or, when requested, a verified fix. Stop when the responsible boundary is sufficiently supported, evidence is unavailable, or the next action requires approval.
