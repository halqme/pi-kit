---
name: deslop
description: Detect and remove low-value or unnatural AI-generated code and prose from a change while preserving intended behavior. Use when the user asks to remove AI slop, clean up an AI-generated patch, make generated code idiomatic, reduce overengineering, or inspect a diff for unnecessary comments, defensive code, type escapes, abstractions, verbosity, or local style inconsistencies.
---

# Remove AI Slop

1. Inspect the complete diff, surrounding files, applicable conventions, types, callers, validation boundaries, and tests. Identify what the change introduced; do not label pre-existing code as part of the cleanup without saying so.
2. Remove comments that merely narrate code, over-explain obvious behavior, use generic section headings, or do not match the file's normal commenting style. Preserve comments that explain intent, invariants, constraints, or non-obvious tradeoffs.
3. Remove redundant guards, validation, fallbacks, `try`/`catch` blocks, and error wrapping that are abnormal at that boundary or duplicate guarantees already enforced by trusted callers. Preserve defenses required at real trust boundaries and failure-prone I/O.
4. Remove `any` casts, unsafe assertions, suppression directives, placeholder types, and type-system workarounds. Resolve the actual type mismatch without weakening the contract.
5. Collapse unnecessary helpers, wrappers, configuration, abstractions, indirection, verbose logging, and speculative extensibility when direct code is clearer and consistent with nearby implementation.
6. Check naming, control flow, formatting, documentation tone, and test style against the same file and neighboring code rather than imposing generic preferences.
7. Adversarially verify that each removal is behavior-preserving and does not discard intentional safety, compatibility, observability, or domain knowledge. Run focused checks, then inspect the final diff for remaining slop and accidental scope expansion.

When the task is solely AI-slop cleanup, finish with only a one-to-three-sentence summary of what changed and any material verification limitation. Do not provide a long file-by-file narration.
