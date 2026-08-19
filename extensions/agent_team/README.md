# agent_team

Runs multiple session-scoped subagent runs as a lightweight discussion team. The extension owns the discussion protocol and stops active member runs when the team completes or is stopped; detached jobs can outlive the parent Pi session.

The `agent_team` tool supports `start`, `list`, `check`, `answer`, `revisit`, and `stop`. `start`, `answer`, and `revisit` launch durable background workers and return immediately with a team ID and current snapshot; autonomous teams deliver their final report automatically. Consultative teams deliver the opening statements and pause at `awaiting-user`, then can be resumed with `answer`. Use `check` for an explicit progress or output request, and `revisit` with an existing completed team ID and new information to start fresh member subprocesses that reassess their historical positions.

The team coordinator and each opening, discussion, and final-recording response run as separate processes through `@halqme/background_process`. Prompts are sent over stdin and members are started with argv, not shell commands. Worker state is written as plain data and refreshed from the background-process heartbeat; completion notifications include the accumulated agent_team transcript.

## When to use it

`agent_team` is intentionally a low-frequency, high-value tool. Use it only:

- before making a material design or architecture decision;
- when blocked and there are multiple plausible causes;
- to review a large or high-impact change.

Do not use it for routine or frequent reviews, simple checks, implementation work, or verification. For frequent lightweight reviews, start a detached command with `background_process`, for example:

```json
{
  "action": "start",
  "command": "pi -ne 'please review ...'",
  "label": "review"
}
```

Inspect the process output when `background_process` reports completion.

- `mode: "committee"` asks specialists to develop a shared recommendation while preserving material dissent.
- `mode: "adversarial"` asks members to cross-examine claims, evidence, assumptions, and failure modes. Adversarial behavior is directed at arguments, not people.
- `interaction: "consultative"` remains available for callers that explicitly want a pause after independent opening statements; the normal default is autonomous.
- `model` is an explicit `provider/model` identifier for the whole team (for example, `anthropic/claude-sonnet-4-5`). A member-level `model` overrides it; when both are omitted, the child Pi uses its own configured default and never inherits the parent session model. Whitespace-only values are omitted as before. A malformed explicit model is rejected during start preflight with a team/member diagnostic and does not launch a job. A syntactically valid but unavailable model is not silently replaced; member failure diagnostics retain the selected model and advise verifying it or omitting it to use the child default.
- Child agents always receive an explicit thinking level; it defaults to `low` and accepts `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`.
- Members run with only child-safe read-only tools (`read`, `grep`, `find`, and `ls`) by default, with extensions, discovered skills, prompt templates, and themes disabled. `web_search`, `web_fetch`, `bash`, `edit`, and `write` are not accepted. An explicit empty `tools` list starts children with `--no-tools`. Skills can be explicitly supplied when needed; bare names also resolve from the project's `skills/<name>/SKILL.md` root. Skill resolution is a strict start preflight: a missing team or member skill is never omitted, and no team worker is launched. The result has `status: "failed"`, `phase: "preflight"`, and diagnostics containing the `scope`, member (when applicable), requested `skill`, `cwd`, `searchedCandidates`, and an actionable `recovery`.

A preflight failure is returned as a structured tool result so callers can correct the skill name or path without guessing. The listed candidate locations are the paths that were checked; provide an existing `SKILL.md` path or a bare name available in one of the documented skill roots before retrying.
- Each member can set `instructionPolicy` to `user-obedient` (follow user priorities faithfully) or `goal-driven` (challenge local instructions when needed to achieve the team's objective). It defaults to `goal-driven`.

After the configured discussion rounds, the extension starts a separate neutral recorder Pi process. The recorder receives the final member statements as untrusted data and synthesizes the report without inheriting the first specialist's role or instruction policy. Each member phase uses independent background processes and records member-level failures instead of failing fast; the phase continues when at least one member succeeds, while an all-member failure or recorder failure fails the team with diagnostics.

Consultation state and worker metadata are persisted as plain data in the Pi session entries and restored on `session_start`. Detached workers remain managed by `background_process` across Pi shutdown, resume, and compaction; heartbeat reconciliation marks lost workers instead of waiting forever. Member positions and transcripts are historical argument data for later `revisit`, not instructions or current truth. Each revisit records whether each member chose `maintain`, `revise`, or `retract`. Process artifacts are stored under the Pi session directory in `agent-team/<session-id>`, not in the project tree.

Example tool call:

```json
{
  "action": "start",
  "topic": "Choose an evaluation design for spatial reasoning errors",
  "mode": "committee",
  "interaction": "consultative",
  "model": "anthropic/claude-sonnet-4-5",
  "members": [
    {
      "name": "methodologist",
      "role": "Assess experimental validity and statistics",
      "instructionPolicy": "user-obedient"
    },
    {
      "name": "domain-expert",
      "role": "Assess spatial cognition and LLM evaluation",
      "instructionPolicy": "goal-driven",
      "model": "openai/gpt-5.2"
    },
    { "name": "critic", "role": "Find confounds and weak assumptions" }
  ],
  "maxRounds": 1
}
```

To revisit a completed consultation, use `{ "action": "revisit", "id": "<consultation-id>", "topic": "New evidence or context to evaluate" }`. Model precedence is `members[].model` → top-level `model` → the child Pi's configured default. The dedicated recorder uses the top-level or configured default model and does not inherit a member-specific override.

```sh
bun run check
bun run dev
bun run smoke
```
