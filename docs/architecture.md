# Pi Kit architecture

Pi Kit is organized around a small set of mechanical runtime boundaries rather than a stack of prompt-driven workflows.

```text
User goal
   |
   v
context ---------> compact repository evidence
   |
   v
code ------------> validated structural mutation
   |
   v
task ------------> adaptive checkpoints / blockers
   | \
   |  `----------> delegate -> isolated Git worktree / branch
   |
   `-------------> verify -> provenance-aware evidence
                           |
                           v
                      task.finish
```

An observation is not authority for a mutation, a completed plan is not authority for completion, and a child agent's report is not authority for integration.

## Repository intelligence

`context` is the read-only repository-intelligence boundary. Conceptual retrieval uses passage-level Okapi BM25, while structural lookup and inspection use Tree-sitter plus optional LSP evidence. These are implementation strategies behind one tool rather than separate product boundaries the model must route between.

`code` is the mutation boundary. It shares the same structural engine instance as `context`, so opaque continuations remain valid across retrieval and mutation. Existing source is edited by validated syntax-node replacement or semantic rename; new, generated, configuration, and unsupported files use ordinary editing.

The design follows the retrieval results reported by Agent Retrieval Bench (arXiv:2607.24882) and FastContext (arXiv:2606.14066), and the structured action-space results in CODESTRUCT (arXiv:2604.05407).

## Adaptive task runtime

`task` stores the goal, acceptance criteria, observations, checkpoints, blockers, and a disposable plan. The plan is a mutable hypothesis, not an approval artifact or completion counter.

`verify` distinguishes evidence executed by the runtime from observations merely reported by the agent. `task.finish` requires a successful executable check from `verify.run`; reported evidence remains useful context but cannot self-certify completion. This boundary is motivated by the self-authored verification failure mode studied in arXiv:2607.24300.

## Isolated delegation

`delegate` creates one Git worktree and branch per child Pi. A worker can mutate freely inside its own workspace, while the parent retains architecture decisions, acceptance, verification, and integration. Process exit is an event, not proof of correctness.

This follows the centralized asynchronous isolated delegation pattern evaluated in arXiv:2603.21489. Pi Kit intentionally does not add a general DAG scheduler until session evidence shows that dependency scheduling is worth the additional machinery.

## Prompt minimization

Stable behavior belongs in tools and runtime state. `AGENTS.md` therefore contains only repository invariants and development mechanics; tool-routing and workflow state are not encoded as an always-on prompt layer. This is consistent with the repository-context results in arXiv:2602.11988.

## Evaluation

`session-metrics` reconstructs runtime behavior from Pi session JSONL without active instrumentation. In addition to generic tool/action metrics, it records the `context`, `code`, `task`, `delegate`, and `verify` surfaces and verification provenance so harness changes can be compared against historical trajectories.

The package manifest is the authoritative capability boundary. There is no compatibility layer for the removed planning, committee, or standalone retrieval/editing tools.
