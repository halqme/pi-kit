---
name: simplify-change
description: Use this skill when implementing or reviewing a code change that may contain unnecessary code, abstractions, dependencies, configuration, indirection, or model-generated boilerplate. Simplify while preserving required behavior, using independent review for non-trivial changes. Do not use solely because code is long when its behavior and complexity are already conventional and required.
---

# Simplify a Change

Prefer the smallest conventional solution that satisfies the current requirements. Optimize for fewer concepts, dependencies, branches, files, and special cases, not minimum line count.

1. Understand the requested behavior and the repository path it affects before simplifying.
2. Before adding or keeping code, ask in order:
   - Does this need to exist?
   - Does the repository already solve it?
   - Does the language or standard library solve it?
   - Does the platform solve it?
   - Does an existing dependency solve it?
   - What is the smallest local implementation that remains clear?
3. Delete, inline, or reuse code when doing so preserves the current contract. Do not create speculative extension points, configuration, wrappers, helpers, dependencies, or fallback paths for hypothetical future needs.
4. For non-trivial generated code, or when the diff adds substantial logic, abstractions, helpers, dependencies, configuration, or indirection, run independent Adversarial and Fool reviews in fresh Pi subprocesses through `background_process`, preferably in parallel with `start_many`. Do not simulate these reviews in the parent context.
5. Treat reviewers as critics, not implementers. They return findings only; the parent decides which findings are valid and performs any edits.
6. Apply accepted findings, then run the repository's existing checks appropriate to the changed behavior. Simplification is incomplete if it breaks required behavior or leaves unjustified complexity.

## Independent reviews

### Adversarial review

Give the reviewer the requested outcome, acceptance criteria, repository access, and resulting diff.

Ask it to assume every addition is unnecessary until a current requirement justifies it. It should look for opportunities to delete, inline, reuse, or replace code with existing repository mechanisms, standard-library functionality, platform primitives, or existing dependencies.

It must not propose new features or architecture. It reports concrete findings and the requirement each challenged addition fails to justify.

### Fool review

Give the reviewer repository access and the resulting diff, but do not provide the implementation discussion, discarded alternatives, or rationale that exists only in the parent's context.

Ask it to review as a maintainer encountering the change without author context. It should flag code whose purpose depends on hidden assumptions, cleverness, unusual idioms, or knowledge that is not recoverable from the repository and diff.

A shorter implementation that is materially harder to understand is not simpler.

## Trivial changes

For an obviously local change with no meaningful new logic or concepts, review locally instead of spawning subprocesses. Do not make independent review overhead larger than the change itself.

## Preserve

Do not simplify away explicitly requested behavior, validation at trust boundaries, security controls, meaningful error handling, accessibility, repository conventions, compatibility requirements that are part of the current contract, or tests that materially protect behavior.
