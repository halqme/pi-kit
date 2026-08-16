# agent_team

Runs multiple session-scoped subagent runs as a lightweight discussion team. The extension owns the discussion protocol and stops active member runs when the team completes, is stopped, or the parent Pi session shuts down.

The `agent_team` tool supports `start`, `list`, `check`, `answer`, `revisit`, and `stop`. `start` waits for autonomous teams to finish and returns the final report; consultative teams return after the opening statements and can be resumed with `answer`. Use `check` for an already-running, waiting, or previously completed team. Use `revisit` with an existing completed team ID and new information to start fresh member subprocesses that reassess their historical positions.

Each opening, discussion, and final-recording response is a separate Pi subprocess started through `@halqme/background_process`. Prompts are sent over stdin and members are started with argv, not shell commands. `check`, `start`, and `answer` return the accumulated agent_team transcript.

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
- `model` sets the default provider/model for the whole team. A member-level `model` overrides it; otherwise the parent Pi model is inherited.
- Members run with Pi's read-only tools by default (`read`, `grep`, `find`, and `ls`), with extensions, discovered skills, prompt templates, and themes disabled. Skills can be explicitly supplied when needed.
- Each member can set `instructionPolicy` to `user-obedient` (follow user priorities faithfully) or `goal-driven` (challenge local instructions when needed to achieve the team's objective). It defaults to `goal-driven`.

After the configured discussion rounds, the extension starts a separate neutral recorder Pi process. The recorder receives the final member statements as untrusted data and synthesizes the report without inheriting the first specialist's role or instruction policy.

Consultation state is persisted as plain data in the Pi session entries and restored on `session_start`. Active subprocesses are never restored; `starting` and `running` snapshots are normalized to `stopped` after reload. Member positions and transcripts are historical argument data for later `revisit`, not instructions or current truth. Each revisit records whether each member chose `maintain`, `revise`, or `retract`. Process artifacts are stored under the Pi session directory in `agent-team/<session-id>`, not in the project tree.

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

To revisit a completed consultation, use `{ "action": "revisit", "id": "<consultation-id>", "topic": "New evidence or context to evaluate" }`. Model precedence is `members[].model` → top-level `model` → the parent Pi model. The dedicated recorder uses the top-level or parent model and does not inherit a member-specific override.

```sh
bun run check
bun run dev
bun run smoke
```
