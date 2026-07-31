---
name: verify-work
description: Verify evidence, outputs, changes, conclusions, and completion claims for any task. Must be used before completing every user task, including implementation, diagnosis, review, research, Git operations, and short factual answers, with verification effort scaled to risk.
---

# Verify Work

1. Restate the task's acceptance conditions and map each material claim or outcome to current evidence. Record confirmed observations separately from interpretation, and identify material uncertainty or genuinely competing explanations instead of presenting an inference as a fact.
2. Discover relevant checks from project documentation, configuration, package scripts, CI, schemas, and source-of-truth artifacts; do not invent commands or standards.
3. Choose the narrowest useful check first. Before running it, state what it should establish, the expected result, and the stop condition; broaden the checks in proportion to scope, uncertainty, reversibility, and impact.
4. Execute the selected checks and inspect full output, warnings, skipped cases, exit status, and truncation. Record actual results, including failures and unexpected output, and state exactly which claim each result supports or fails to establish.
5. Perform an adversarial pass: identify the strongest plausible way the result could be wrong, incomplete, misleading, unsafe, or over-scoped, then seek evidence that would expose it.
6. Keep the adversarial check independent from the producing argument where practical. Prefer counterexamples, negative tests, boundary cases, alternate explanations, fresh inspection, and tests that would fail under the suspected mistake. If evidence does not settle the question, update the conclusion and run the next discriminating check rather than repeating an unchanged one.
7. Prefer durable enforcement through types, tests, linters, schemas, or AST checks over prose-only guarantees.
8. For Git-related work, inspect `git status --short`, `git diff --check`, and the relevant staged and unstaged diffs. When a commit is requested, verify the resulting commit, branch, included paths, and remaining working-tree changes; confirm that no unrelated, generated, sensitive, or unpublished external changes were included. If evidence is unavailable or the next check needs approval, stop and report the gap and safest next step.
9. Report what each check establishes, checks skipped and why, remaining uncertainty or risk, and any claim that could not be verified. Never claim correctness beyond the evidence.

For a trivial or read-only task, the pass may be brief, but it must still challenge the most consequential assumption. If a meaningful challenge is impractical, state that limitation.
