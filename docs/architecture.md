# Pi Kit vNext architecture

## Design target

Pi Kit treats a coding agent as a runtime with a few mechanically meaningful boundaries rather than a stack of prompt-driven workflows.

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

The central rule is that an observation is not authority for a mutation, a completed plan is not authority for completion, and a child agent's report is not authority for integration.

## Context acquisition

`context` is the repository-intelligence boundary. Conceptual retrieval uses the existing passage-level BM25 implementation, while structural lookup and inspection reuse Tree-sitter/LSP resolution. These mechanisms are now exposed as one retrieval surface instead of asking the model to reason about separate product boundaries.

This follows Agent Retrieval Bench (arXiv:2607.24882), which finds that no retrieval family dominates across repository tasks and that logged coding-agent trajectories miss every gold file on 27-35% of samples. It also follows FastContext (arXiv:2606.14066), which shows that separating repository exploration from solving can improve resolution while materially reducing solver token consumption.

A later context implementation may add repository maps or a dedicated explorer model, but the runtime does not require embeddings or a persistent index until local evaluation shows they improve Pi Kit's own task distribution.

## Structured mutation

`code` is the mutation boundary. It reuses the Astrolabe kernel's continuation handles, Tree-sitter anchors, staleness checks, syntax validation, mutation queue, and LSP rename flow, but retrieval actions are presented through `context`.

This is consistent with CODESTRUCT (arXiv:2604.05407), where code agents operating on named AST entities improved Pass@1 and reduced token consumption compared with text-span editing.

## Adaptive task state

The old `plan -> planner -> runner -> loop` surface is replaced by one adaptive task state. A task records the goal, optional acceptance criteria, observations, checkpoints, blockers, and the current disposable plan. The plan is not an approval artifact or a finite-state workflow; it is a mutable hypothesis.

`task.finish` is intentionally disconnected from plan-step counts. It requires strong verification evidence recorded by `verify`.

## Isolated delegation

`delegate` creates a dedicated Git worktree and branch for each child Pi. The worker can mutate freely inside that isolation and is instructed to commit coherent changes before finishing. The parent remains responsible for inspection, verification, and integration.

This follows Centralized Asynchronous Isolated Delegation from *Effective Strategies for Asynchronous Software Engineering Agents* (arXiv:2603.21489), which identifies isolated workspaces and branch-and-merge Git primitives as central mechanisms for reliable multi-agent software work.

Pi Kit does not add a general DAG scheduler yet. Isolation is the high-value primitive; dependency scheduling should be added only when actual sessions demonstrate a need.

## Verification provenance

`verify` separates evidence by provenance. Existing tests, CI, compilers, typecheckers, linters, explicit user acceptance, and structural audits are strong evidence. Agent-authored tests, self-review, and review agents are supporting evidence.

This policy is motivated by *Self-Authored Verification Is Unreliable in Heuristic Self-Improving Agents* (arXiv:2607.24300): when an agent controls both the optimized artifact and its verifier, self-score can remain high while deployment performance regresses. The runtime therefore requires at least one acceptance signal outside the agent's self-authored verifier before `task.finish` succeeds.

## Prompt minimization

The runtime no longer loads the always-on Inception policy or the old planning guidance. `AGENTS.md` is reduced to repository invariants and development mechanics.

This follows *Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?* (arXiv:2602.11988), which reports lower task success and more than 20% higher inference cost from unnecessary repository context, and recommends keeping human-written context files to minimal requirements.

## Runtime manifest

`package.json` explicitly enumerates loaded extensions and skills. Historical extension directories can remain in the repository without becoming agent-visible tools. This makes removal from the active runtime cheap and makes the package manifest the authoritative capability boundary.

## Evaluation direction

`session_metrics` is the natural evaluation substrate. The next metrics worth adding are retrieval hit rate, redundant reads, edit/revert cycles, failed structural edits, replan count, evidence provenance, and post-completion user correction. Harness changes should be evaluated against frozen historical tasks before becoming defaults.
