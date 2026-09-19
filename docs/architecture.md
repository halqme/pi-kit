# Pi Kit architecture

Pi Kit is organized around a small set of mechanical runtime boundaries rather than a stack of prompt-driven workflows. These boundaries define authority, not a mandatory execution order.

```text
Repository evidence ───────> context ───────> structural targets / compact evidence
        │
        └──────────────────> code ─────────> validated mutation

User goal ─────────────────> task ─────────> adaptive checkpoints / blockers
                               | \
                               |  `────────> delegate -> isolated Git worktree / branch
                               |
                               `───────────> verify -> provenance-aware evidence
                                                    |
                                                    v
                                               task.finish
```

An observation is not authority for a mutation, a completed plan is not authority for completion, and a child agent's report is not authority for integration. Likewise, `context` is not a qualification gate for `code`: structural discovery is useful only when it provides leverage.

## Repository intelligence

`context` is the read-only repository-intelligence boundary. Conceptual retrieval uses passage-level Okapi BM25, while structural lookup and inspection use Tree-sitter plus optional LSP evidence. These are implementation strategies behind one tool rather than separate product boundaries the model must route between.

`code` is the mutation boundary. It shares the same structural engine instance as `context`, so opaque continuations remain valid across retrieval and mutation. A continuation is the strongest target when structural discovery has already selected a node, but it is not required merely to enter the mutation boundary. An exact unique text target can be resolved to the smallest containing syntax node inside the same engine, then use the same validated node-replacement path. Semantic rename continues to use LSP workspace edits. The repository extension overrides the built-in `edit` tool so a single exact replacement in supported source takes this validated path automatically; multi-edit calls and new or unsupported files retain ordinary editing behavior; source-based generated and configuration files follow the supported-language route. This runtime integration makes the safety boundary effective without relying on `AGENTS.md` or model tool-selection prose.

This separation keeps structured discovery and structured mutation independent: `context` competes with ordinary repository reading on retrieval value, while `code` can still provide mutation validation after evidence came from `read`, search, diagnostics, or another source.

The design follows the retrieval results reported by Agent Retrieval Bench (arXiv:2607.24882) and FastContext (arXiv:2606.14066), and the structured action-space results in CODESTRUCT (arXiv:2604.05407).

## Adaptive task runtime

`task` stores the goal, acceptance criteria, observations, checkpoints, blockers, and a disposable plan. The plan is a mutable hypothesis, not an approval artifact or completion counter.

`verify` distinguishes evidence executed by the runtime from observations merely reported by the agent. `task.finish` requires a successful executable check from `verify.run`; reported evidence remains useful context but cannot self-certify completion. This boundary is motivated by the self-authored verification failure mode studied in arXiv:2607.24300.

## Isolated delegation

`delegate` creates one Git worktree and branch per child Pi. A worker can mutate freely inside its own workspace, while the parent retains architecture decisions, acceptance, verification, and integration. Process exit is an event, not proof of correctness.

This follows the centralized asynchronous isolated delegation pattern evaluated in arXiv:2603.21489. Pi Kit intentionally does not add a general DAG scheduler until session evidence shows that dependency scheduling is worth the additional machinery.

## Prompt minimization

Stable behavior belongs in tools and runtime state. `AGENTS.md` therefore contains only repository invariants and development mechanics; tool-routing and workflow state are not encoded as an always-on prompt layer. This is consistent with the repository-context results in arXiv:2602.11988.


## Experimental semantic observation

`semantic-observer` is outside the mechanical authority path. Its outputs are observations only: they cannot mutate repository state, satisfy `verify`, or unlock `task.finish`. The Pi-facing extension adapts runtime evidence; `packages/semantic-predicate` owns the Pi-independent OpenRouter Decisions API client and typed Jev primitives.

The context boundary is intentionally narrower than the model context window. Jev 1.13 degrades when state contains irrelevant detail, so the observer does not treat the current conversation or repository as a default context blob. Each semantic judgment declares the evidence it needs and receives a small structured state with named fields. Primary runtime or repository evidence is preferred over a model-authored narrative summary.

The observer does not ask the calling model to summarize its own work. It projects existing Pi Kit runtime state instead. `task/evidence.ts` exposes the same side-effect-free packet used by `task.review_context`: task contract and latest checkpoint, resource provenance, workspace delta, and verification evidence. The semantic observer augments that packet with a bounded Git diff from the task's captured baseline and bounded excerpts from successful `read`/`context` tool results identified by their tracked tool-call IDs.

The current context views are:

```text
scopeDrift
  task goal + acceptance
  + current checkpoint (plan marked as hypothesis)
  + tracked mutations + task-baseline diff

verificationGap
  task goal + acceptance
  + tracked mutations + task-baseline diff
  + executed verification only

consistencyRisk
  tracked mutations + task-baseline diff
  + paths observed during the task
  + bounded excerpts from the exact read/context results already seen
```

The caller supplies only which observation IDs to run. These are separate requests because their evidence sets differ. If future questions genuinely share the same state, they should be batched into one Decisions API request; Jev evaluates questions independently and batching avoids sending the same state repeatedly.

This boundary follows four rules:

1. **Filter before inference.** Retrieval and runtime state select evidence before Jev sees it.
2. **Semantic only.** Exact checks, counts, dates, presence tests, and arithmetic stay in code.
3. **Probabilities before policy.** Raw Noul probabilities or Choice/Score distributions are recorded first; thresholds and actions belong to deterministic policy outside the package.
4. **No ambient accumulation.** Session history, broad diffs, repository dumps, and prior semantic answers are not automatically carried forward. A second-stage request receives earlier output only when code needs that result to construct genuinely new state.

The experiment is intentionally explicit-call. Automatic hooks, escalation, or review routing should be added only after session evidence shows which judgments are useful and how their probabilities calibrate on Pi Kit work.

## Evaluation

`session-metrics` reconstructs runtime behavior from Pi session JSONL without active instrumentation. In addition to generic tool/action metrics, it records the `context`, `code`, `task`, `delegate`, and `verify` surfaces and verification provenance so harness changes can be compared against historical trajectories.

The package manifest is the authoritative capability boundary.
