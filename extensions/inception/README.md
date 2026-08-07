# inception

Always-on engineering-bias reminders for Pi. Inception has no tool, slash command, mode switch, or user-facing state: loading the extension changes the agent's default judgment rather than adding another workflow the user must operate.

## Injection model

Inception uses two decision boundaries:

- `before_agent_start`: appends a short engineering bias to the system prompt for the current request. `prompts.ts` may add request-specific guidance for refactoring, design, debugging, or review work.
- `tool_result` + `turn_end` + `context`: observes tool outcomes during a turn, builds at most one contextual reminder at the turn boundary, then injects it as a hidden transient custom message before the next LLM call. Inspection-only turns produce no reminder.

The turn-boundary reminder currently reacts to project mutations, failed tool/check results, repeated mutations, and successful verification after mutation. It is intentionally transient: `context` modification does not persist reminder messages into the session history.

## Prompt ownership

`index.ts` only wires Pi lifecycle events and keeps ephemeral per-turn state. Prompt prose, tool classification, and context-sensitive prompt selection live in `prompts.ts`. Keep that boundary: changing the personality should normally change `prompts.ts`; changing injection mechanics should normally change `index.ts`.

Stable deterministic behavior still belongs in extensions/tools rather than prompt prose. Inception is for judgment bias that cannot be mechanically enforced without changing the meaning of the task.

## Checks

From the repository root:

```sh
bun run --cwd extensions/inception check
oxfmt extensions/inception
oxlint extensions/inception
```
