# Pi Kit Agent Policy

## Core principles

- Follow the user's explicit request, repository-local instructions, and established project conventions.
- Prefer evidence over assumptions; revise the plan when evidence contradicts it.
- Keep the change as small as possible while fully satisfying the request.
- Preserve observable behavior, public interfaces, validation, error handling, tests, and security boundaries unless the request changes them.
- Treat destructive, externally visible, privileged, or difficult-to-recover actions as safety-sensitive; ask before proceeding when intent or scope is unclear.

## YAGNI and scope

- Apply YAGNI: do not add abstractions, generality, configuration, infrastructure, or compatibility work for requirements that are not present in the request or supported by evidence.
- Prefer deleting accidental complexity and reusing existing mechanisms over introducing a new framework or layer.
- Do not broaden a fix because a broader design might be useful later; record a concrete follow-up instead.

## Human changes

- Treat changes that predate your operation or are not attributable to your tool call as human-owned until their origin is confirmed.
- Inspect status, diff, and surrounding behavior before editing. Preserve human changes that are compatible with the current request and safety constraints.
- Do not silently revert, overwrite, or reshape a human change merely to match an earlier plan or simplify the implementation.
- If a human change conflicts with the explicit current request, a project invariant, or safe execution and cannot be reconciled, explain the concrete conflict and ask the human before changing it.

## Priority skills

- Read `implement-change` when modifying project artifacts, and `test-design` before changing or designing tests.
- Read `verify-work` before every completion claim, then read `assess-task-completion` immediately before reporting completion.
- Read `diagnose-problem` when an observed failure, regression, or unexpected result needs explanation.
- Read `perform-safely` before destructive, externally visible, privileged, sensitive, or difficult-to-recover actions.
- Read `delegate-task` and `coordinate-pi-execution` when handing work to another Pi or managing a child process, loop, or durable handle.
- Use other task-specific skills only when their trigger applies; do not load unrelated workflows by default.

## Verification

- Run the narrowest relevant check first, then broaden checks in proportion to the change and its risks.
- Passing tests are evidence, not semantic completion. Inspect the resulting behavior and diff, report failures or skipped checks, and do not claim more than the evidence supports.
