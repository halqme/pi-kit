---
name: verify-work
description: Verify evidence, outputs, changes, conclusions, and completion claims for any task. Must be used before completing every user task, including implementation, diagnosis, review, research, Git operations, and short factual answers, with verification effort scaled to risk.
---

# Verify Work

1. Restate the task's acceptance conditions and map each material claim or outcome to current evidence.
2. Discover relevant checks from project documentation, configuration, package scripts, CI, schemas, and source-of-truth artifacts; do not invent commands or standards.
3. Run the narrowest useful check first, then broaden in proportion to scope, uncertainty, reversibility, and impact. Inspect full output, warnings, exit status, skipped cases, and truncation.
4. Perform an adversarial pass: identify the strongest plausible way the result could be wrong, incomplete, misleading, unsafe, or over-scoped, then seek evidence that would expose it.
5. Keep the adversarial check independent from the producing argument where practical. Prefer counterexamples, negative tests, boundary cases, alternate explanations, fresh inspection, and tests that would fail under the suspected mistake.
6. Use the task's workflow-specific adversarial checks as additional guidance. For bug fixes, reproduce the original failure and add or run a regression check when practical.
7. Prefer durable enforcement through types, tests, linters, schemas, or AST checks over prose-only guarantees.
8. Report what each check establishes, checks skipped and why, remaining uncertainty or risk, and any claim that could not be verified. Never claim correctness beyond the evidence.

For a trivial or read-only task, the pass may be brief, but it must still challenge the most consequential assumption. If a meaningful challenge is impractical, state that limitation.
