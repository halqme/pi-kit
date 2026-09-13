# AGENTS.md

Pi Kit is a Bun workspace for Pi extensions, skills, prompts, and support packages.

- Keep changes scoped to the requested outcome. Remove superseded implementation instead of preserving compatibility layers unless compatibility is explicitly required.
- Stable behavior belongs in code, schemas, tests, or runtime state rather than always-on prompt prose.
- Existing supported source should use the repository `context`/`code` path when structural editing provides leverage; new/config/generated/unsupported files may use ordinary editing.
- Verification must use the repository's existing checks. Do not treat an agent-authored test or self-review as the only proof of completion when an executable existing check is available.
- Do not push, merge, rebase, alter refs, or open a pull request unless explicitly requested. Commits are allowed after verification unless the user says not to commit.

Primary validation:

```sh
bun run check
```

For a focused workspace, run its `check` script first, then broaden as needed. Do not disable lint or tests to make a change pass.
