# Pi Kit

Pi Kit is a deliberately small runtime layer for Pi Coding Agent. The active architecture is organized around five mechanical authority boundaries, not a mandatory execution pipeline:

```text
repository evidence ──> context
         │
         └────────────> code

user goal ────────────> task ─────> verify ─────> task.finish
                          \
                           └───────> delegate
```

- `context` acquires repository evidence through lexical and structural retrieval.
- `code` performs validated mutation of supported existing source. A structural continuation is the strongest target when `context` already produced one; an exact unique text target can enter the same structural mutation engine directly.
- The repository extension also routes single built-in `edit` replacements in supported source through that validator automatically, without requiring prompt or `AGENTS.md` instructions.
- `task` keeps lightweight goal, checkpoint, blocker, and completion state.
- `verify` distinguishes executed checks from reported evidence; only executed strong checks can unlock completion.
- `delegate` runs independent child Pi work in isolated Git worktrees and branches.

The arrows describe common evidence and authority flow. They are not prerequisites between tools: `context` is not a qualification gate for `code`, and `delegate` is only useful when the work actually decomposes.

## Layout

```text
extensions/
  ask/
  background-process/
  browser-inspector/
  delegate/
  repository/
    src/
      context/
      code/
      syntax/
  session-metrics/
  semantic-observer/
  task/
  terminal/
packages/
  semantic-predicate/
skills/
prompts/
docs/
tsconfig.json
```

`extensions/` remains the home of Pi runtime integration. `packages/` is reserved for code that is meaningful without Pi; both are root workspaces. The experimental `semantic-predicate` package lives under `packages/` so Jev/OpenRouter evaluation can be removed or reused without changing Pi runtime contracts. `session-metrics` continues to own both its Pi extension and offline CLI/analysis kernel. Multi-word extension directories use kebab-case, and the shared TypeScript configuration lives at the repository root.

The repository extension exposes `context` and `code`, and transparently strengthens the built-in `edit` path for supported source files. The old standalone Astrolabe and BM25 tool surfaces are gone; their useful structural and lexical mechanisms are internal implementation details under `src/syntax` and `src/context`.

Additional independent utilities remain available through the extensions listed above. `ask` provides synchronous structured user decisions in the interactive TUI; offline session analysis is provided by the `session-metrics` CLI in `extensions/session-metrics`. `semantic-observer` is an experimental, explicitly invoked observer: the caller selects semantic judgments, while Pi Kit builds compact evidence from task state, tracked reads/context, actual workspace changes, and executed verification. It returns advisory probabilities without changing task, verification, or completion state.


## Experimental semantic observation

`semantic-observer` treats Jev as a sensor, not an authority. It uses OpenRouter's Decisions API through the Pi-independent `packages/semantic-predicate` package and keeps thresholds or actions outside the model boundary.

Context is assembled as evidence, not as a transcript:

- Prefer runtime-captured primary evidence: the task goal and acceptance criteria, tracked mutations and the task-baseline Git diff, executed verification, and the successful `read`/`context` results the agent actually observed.
- Keep fields named and structured. Questions refer to the state fields they judge rather than relying on one opaque prompt.
- Give each judgment only the fields it needs. Questions that need different evidence are evaluated against separate minimal states; questions with the same state may be batched.
- Keep deterministic facts in code. Jev is for semantic judgments such as scope drift or whether verification meaningfully covers a change, not whether a check exists or how many files changed.
- Preserve probabilities. The observer does not turn Jev output into a pass/fail result; later policy may choose thresholds after the behavior has been measured.
- Do not feed broad session history, repository dumps, or previous Jev outputs back into later state by default. Add context only when it is evidence for the next judgment.

The current observer accepts only an `observations` list (`scopeDrift`, `verificationGap`, `consistencyRisk`). Evidence payloads are not authored by the calling model. It is deliberately explicit-call and advisory while the experiment is being evaluated.

See [`docs/architecture.md`](docs/architecture.md) for the design rationale and runtime contracts.
