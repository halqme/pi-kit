---
name: review-change
description: Review code, diffs, pull requests, patches, tests, configuration, or technical documents for correctness and maintainability. Use when the user asks for review, critique, risk assessment, regression analysis, or actionable findings without requesting implementation. Do not use for implementation unless a fix is separately requested.
---

# Review a Change

1. Inspect applicable instructions, the complete diff or artifact, surrounding implementation, requirements, tests, and relevant project history. Do not review a patch in isolation when its behavior depends on nearby code.
2. Determine the intended behavior and affected boundaries before judging the implementation.
3. Check correctness, edge cases, failure handling, compatibility, security, data integrity, concurrency, performance, resource ownership, observability, test adequacy, type-system escapes, and unnecessary code or commentary inconsistent with surrounding files.
4. Validate suspected defects with code paths, types, commands, or focused experiments when practical. Do not report stylistic preferences as bugs.
5. Adversarially review both directions: seek a realistic counterexample that breaks apparently correct behavior, and try to disprove each proposed finding so false positives do not survive.
6. Report actionable findings first, ordered by impact. For each finding, identify the precise location, triggering conditions, mechanism, user or system impact, and a concise remediation direction.
7. Keep summaries brief. If no actionable findings remain, say so and state what was inspected, how the change was challenged, and what could not be verified.

Do not edit artifacts unless the user also asks for fixes. Avoid duplicating one root cause across multiple findings.

## Trigger and contract

Use for review of a diff, patch, pull request, test, configuration, or technical document when the requested result is critique rather than implementation. Do not edit unless a fix is separately requested. Input is the complete artifact and its intended behavior; output is actionable findings ordered by impact, or a concise no-findings report with verification limits. Stop when the artifact or required context is incomplete instead of reviewing a partial contract as definitive.
