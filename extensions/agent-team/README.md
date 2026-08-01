# agent-team

Runs multiple session-scoped subagent runs as a lightweight discussion team. The extension owns the discussion protocol and stops active member runs when the team completes, is stopped, or the parent Pi session shuts down.

The `agent_team` tool supports `start`, `list`, `check`, `answer`, and `stop`. `start` waits for autonomous teams to finish and returns the final report; consultative teams return after the opening statements and can be resumed with `answer`. Use `check` for an already-running or waiting team.

Each opening, discussion, and final-recording response is a separate Pi subprocess started through `@halqme/background-process`. Prompts are sent over stdin and members are started with argv, not shell commands. `check`, `start`, and `answer` return the accumulated agent-team transcript.

- `mode: "committee"` asks specialists to develop a shared recommendation while preserving material dissent.
- `mode: "adversarial"` asks members to cross-examine claims, evidence, assumptions, and failure modes. Adversarial behavior is directed at arguments, not people.
- `interaction: "consultative"` remains available for callers that explicitly want a pause after independent opening statements; the normal default is autonomous.
- `model` sets the default provider/model for the whole team. A member-level `model` overrides it; otherwise the parent Pi model is inherited.
- Members run with Pi's read-only tools by default (`read`, `grep`, `find`, and `ls`), with extensions, discovered skills, prompt templates, and themes disabled. Skills can be explicitly supplied when needed.
- Each member can set `instructionPolicy` to `user-obedient` (follow user priorities faithfully) or `goal-driven` (challenge local instructions when needed to achieve the team's objective). It defaults to `goal-driven`.

The first member acts as the final recorder after the configured discussion rounds. Teams are in-memory only and do not survive `/reload` or parent session shutdown.

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

Model precedence is `members[].model` → top-level `model` → the parent Pi model.

```sh
bun run check
bun run dev
bun run smoke
```
