# Pi Kit

Pi Kit is an opinionated runtime for coding agents built around five boundaries:

```text
context acquisition -> structured mutation -> adaptive task state
                    -> isolated delegation -> provenance-aware verification
```

The public core is intentionally small. Planning, continuation, review, delegation, and completion are not separate workflow products anymore; they are runtime concerns behind four tools plus verification.

## Install

```sh
pi install git:github.com/halqme/pi-kit
```

Requirements:

- Node.js 24 or later
- Bun 1.3.14 or later

## Core tools

### `context`

Repository context acquisition. `find` uses passage-level BM25 for conceptual retrieval; `locate`, `search`, `inspect`, and `inspect_many` reuse the structural/LSP kernel formerly exposed as Astrolabe. Retrieval is separated from mutation so exploratory history does not need to become edit authority.

### `code`

Structure-aware mutation. `edit` replaces one validated syntax node and `rename` applies an LSP-generated semantic rename after staleness and syntax checks. Continuations come from `context` and are session-scoped capabilities.

### `task`

One adaptive task state with a goal, optional acceptance criteria, checkpoints, observations, a disposable current plan, blockers, and evidence-backed completion. There is no approval-gated planner and no step-count completion rule. A plan is a hypothesis that may be replaced as new observations arrive.

### `delegate`

Starts a child Pi in its own Git worktree and branch. Workers are isolated by construction instead of coordinating writes through prompt conventions. A worker is expected to commit its branch, but its exit is only an event: the parent still inspects and verifies before integration.

### `verify`

Records verification evidence together with provenance. Existing tests, CI, compilers, typecheckers, linters, user acceptance, and structural audits count as strong evidence. Agent-authored tests and self-review remain useful supporting signals but cannot alone satisfy `task.finish`.

## Utility extensions

The package also loads `background_process`, `browser_inspector`, `session_metrics`, `statusline`, `suggest_reload`, and `terminal`. They are utilities rather than orchestration layers.

Older experimental extensions remain in the repository as implementation substrate and historical reference, but they are not loaded by the package manifest. Runtime behavior is defined by the explicit `pi.extensions` and `pi.skills` lists in `package.json`.

## Why this shape

The redesign follows several recent results in coding-agent research:

- structured AST/entity mutation improves reliability and reduces token use;
- repository retrieval has no single winning strategy, while focused context selection matters materially;
- separating repository exploration from solving can reduce solver-context pollution;
- asynchronous multi-agent work benefits from isolated workspaces and branch-and-merge coordination;
- self-authored verification is not a trustworthy acceptance signal by itself;
- oversized repository instruction files can reduce task success and increase inference cost.

See [docs/architecture.md](./docs/architecture.md) for the design rationale and research references.

## Development

```sh
bun install
bun run check
```

For a focused change, run the nearest package checks first and then the repository check. The package uses an explicit runtime manifest, so adding a directory under `extensions/` does not make it active unless `package.json` loads it.
