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

## Current stack

- Use the repository's existing Bun, TypeScript, Oxfmt, Oxlint, and test commands; do not introduce another toolchain without evidence.
- Use `bm25_search` to discover an unfamiliar responsibility or behavior before narrowing to exact symbols or literals.
- For existing Deno, Go, JavaScript, Python, or TypeScript source, use `astrolabe` first: locate the target, inspect only the needed nodes, and replace or rename through its validated handles. Use `read` and ordinary edits for Markdown, configuration, new, generated, or unsupported files.
- Use `agent_team` for read-only committee or adversarial review. Delegate implementation only when the workstream is independent and the parent retains scope and verification; coordinate child Pi, terminal, and intercom lifecycles explicitly.
- Use `background_process` for detached non-interactive commands and `terminal` for interactive TTY work, control keys, or watches. Use bounded loops and approval-gated planning or runner workflows only when the task needs them.
- Use the matching task skill when one exists, especially for implementation, test design, diagnosis, safe operation, delegation, verification, and completion assessment.

## Verification

- Run the narrowest relevant check first, then broaden checks in proportion to the change and its risks.
- Passing tests are evidence, not semantic completion. Inspect the resulting behavior and diff, report failures or skipped checks, and do not claim more than the evidence supports.
