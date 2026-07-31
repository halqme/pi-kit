---
name: implement-change
description: Implement, modify, refactor, or remove code, configuration, tests, or documentation. Use when the user asks Pi to build something, change behavior, fix an identified issue, clean up code, or otherwise edit project artifacts.
---

# Implement a Change

1. Inspect the request, applicable instructions, current diff, source-of-truth documents, relevant implementation, tests, and project commands.
2. State the intended outcome and acceptance criteria. For non-trivial work, give a brief implementation and verification plan before editing.
3. Identify the smallest coherent change. Preserve unrelated user edits and avoid opportunistic refactors.
4. Implement in the project's existing style. Keep behavior, interfaces, validation, error handling, and compatibility unchanged unless the request requires otherwise.
5. Update tests and documentation when the externally observable behavior, contract, or operating procedure changes.
6. Run the narrowest relevant checks first, then broader checks proportionate to risk. Inspect full failures and fix causes rather than suppressing signals.
7. Adversarially challenge the implementation: try boundary and invalid inputs, failure paths, compatibility assumptions, and a plausible counterexample to the acceptance criteria. Add a regression test when it provides durable protection.
8. Review the final diff for scope, accidental changes, stale comments, secrets, missing coverage, style inconsistent with surrounding code, type-system escapes, abnormal defensive code, and obvious performance or resource regressions.
9. Report the outcome, files or behavior changed, verification results, adversarial checks, skipped checks, and remaining risk.

Stop and ask before a choice that materially changes product behavior, public interfaces, data, dependencies, or external state and cannot be resolved from project evidence.
