---
name: diagnose-problem
description: Diagnose failures, regressions, anomalies, flaky behavior, performance problems, or unexpected results. Use when the user asks why something is broken, requests root-cause analysis, provides an error or failing check, or asks Pi to debug an issue.
---

# Diagnose a Problem

1. Define observed behavior, expected behavior, impact, environment, and the earliest known failure. Separate reported facts from assumptions.
2. Inspect applicable instructions, current changes, relevant code and configuration, complete errors or logs, and recent history when available.
3. Reproduce the problem with the smallest faithful command or artifact when safe and practical. Record what the reproduction proves.
4. Form a short, ranked set of hypotheses. Run discriminating checks that can eliminate alternatives; do not make random edits or repeat unchanged commands.
5. Trace the failure to the responsible boundary and explain the causal mechanism with concrete evidence. Distinguish root cause from trigger and symptom.
6. Adversarially challenge the leading diagnosis: construct the strongest competing explanation, identify evidence that would distinguish it, and attempt that check. Confirm that the proposed cause predicts the observed behavior better than correlation alone.
7. If the user requested diagnosis only, stop before editing and recommend the smallest viable fix plus a verification plan.
8. If the user requested a fix, apply the `implement-change` workflow, add or run a regression check, and verify both the original failure and relevant neighboring behavior.
9. Report confirmed findings, evidence, eliminated hypotheses, adversarial checks, unresolved uncertainty, and next steps.

For intermittent issues, vary one factor at a time and preserve timestamps, seeds, versions, inputs, and environment details needed to reproduce the result.
