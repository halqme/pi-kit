# Pi Kit

Pi Kit is a deliberately small runtime layer for Pi Coding Agent 0.99.1 and newer. Its runtime is organized around mechanical authority boundaries, while its default model-visible surface stays deliberately small:

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
skills/
prompts/
docs/
tsconfig.json
```

`extensions/` is the home of Pi runtime integration. The root workspace reserves `packages/*` for code that is meaningful without Pi. `session-metrics` owns both its Pi extension and offline CLI/analysis kernel. Multi-word extension directories use kebab-case, and the shared TypeScript configuration lives at the repository root.

The default Pi Kit package adds only two direct model tools: `delegate` and `terminal`. Pi's built-in `codemode` is the structured orchestration boundary. Pi Kit registers `context`, `code`, `task`, and `verify` with `exposure: "codemode"`, so they are callable from Codemode scripts without becoming additional top-level model tools. Repository `read` / `edit` overrides keep their built-in names.

Specialized `browser_inspector`, `macos_talk`, `session_metrics`, and `semantic_observe` tools use deferred exposure and remain discoverable from Codemode through `searchTools()` / `ALL_TOOLS`. The interactive `ask` extension remains in the repository as an optional standalone model-only tool, but is not loaded by the default Pi Kit package.

`terminal` owns persistent shell-process lifecycle for both interactive sessions and asynchronous one-shot subprocesses. `delegate` remains separate because it owns isolated Git worktrees, branches, worker commits, and integration rather than generic process execution.

## Experimental semantic observation

`semantic-observer` treats Jev as a sensor, not an authority. It uses Pi's `modelRegistry.classify()` with the configured TypeSafe `jev-latest` boolean classifier; Pi resolves the model and its credentials through the standard model registry and auth configuration. The caller selects judgments, Pi Kit assembles their evidence, and the tool returns probabilities plus classifier usage without converting them into pass/fail decisions.

Context is assembled as evidence, not as a transcript:

- Prefer runtime-captured primary evidence: the task goal and acceptance criteria, tracked mutations and the task-baseline Git diff, executed verification, and successful `read`/`context` results the agent actually observed. Since nested Codemode results may not appear as independent transcript entries, the task runtime retains at most four bounded text excerpts from nested observations, linked to their parent tool call.
- Keep fields named and structured. Questions refer to the state fields they judge rather than relying on one opaque prompt.
- Give each judgment only the fields it needs. Each selected observation is evaluated against its own minimal state and classifier request.
- Keep deterministic facts in code. Jev is for semantic judgments such as scope drift or whether verification meaningfully covers a change, not whether a check exists or how many files changed.
- Preserve probabilities. The observer does not turn Jev output into a pass/fail result; later policy may choose thresholds after the behavior has been measured.
- Do not feed broad session history, repository dumps, or previous Jev outputs back into later state by default. Add context only when it is evidence for the next judgment.

The current observer accepts only an `observations` list (`scopeDrift`, `verificationGap`, `consistencyRisk`). Evidence payloads are not authored by the calling model. It is deliberately explicit-call and advisory while the experiment is being evaluated.

See [`docs/architecture.md`](docs/architecture.md) for the design rationale and runtime contracts.

## Standalone skills

The following skills do not require Pi-Kit-specific extensions. References to other skills alone do not make a skill non-standalone.

Install an individual skill with:

```sh
bunx skills add http://github.com/halqme/pi-kit --skill <skill-name>
```

- `apply-correction`
- `cognitive-rhythm-writing`
- `git-workflow`
- `natural-japanese-writing`
- `perform-safely`
- `place-knowledges`
- `research-answer`
- `shape-actionable-output`
- `test-design`
- `visualize-structure`
- `write-commit-message`
- `writing-skills`

See [`docs/architecture.md`](docs/architecture.md) for the design rationale and runtime contracts.
