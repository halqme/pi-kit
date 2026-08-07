# inception

Always-on engineering-bias reminders for Pi. Inception has no tool, slash command, mode switch, or user-facing state: loading the extension changes the agent's default judgment rather than adding another workflow the user must operate.

## Injection model

Inception uses two decision boundaries:

- `before_agent_start`: appends a short engineering bias to the system prompt for the current request. `prompts/agent-start.ts` selects request-specific guidance for refactoring, design, debugging, or review work.
- `tool_result` + `turn_end` + `context`: observes tool outcomes during a turn, builds at most one contextual reminder with `prompts/turn-boundary.ts`, then injects it as a hidden transient custom message before the next LLM call. Read-only turns produce no reminder.

The turn-boundary reminder currently reacts to project mutations, failed tool/check results, repeated mutations, and synchronous verification after mutation. It is intentionally transient: `context` modification does not persist reminder messages into the session history.

## Prompt ownership

Injection mechanics and prompt content are separate:

- `index.ts`: Pi lifecycle wiring and ephemeral per-turn state
- `observation.ts`: tool-result classification and accumulated signals
- `prompts/agent-start.ts`: prompt injected at agent start and its request-context selection
- `prompts/turn-boundary.ts`: prompt injected after relevant tool activity and its context-dependent construction

Keep prompt text with its injection timing. TypeScript is intentional: each prompt module can select or construct guidance from the context available at that boundary without coupling the prose to hook plumbing.

Stable deterministic behavior still belongs in extensions/tools rather than prompt prose. Inception is for judgment bias that cannot be mechanically enforced without changing the meaning of the task.

## Checks

From the repository root:

```sh
bun run --cwd extensions/inception check
oxfmt extensions/inception
oxlint extensions/inception
```
