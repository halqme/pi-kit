---
name: consistency-review
description: Review a completed or nearly completed project change for inconsistencies between related artifacts such as implementation, documentation, tests, schemas, configuration, examples, generated contracts, or migrations. Use when a change may leave the project saying different things in different places; do not use as a substitute for executable verification.
---

# Review Project Consistency

1. Call `task` with `action: "review_context"` and use the returned packet as context for the review. Treat resource provenance as leads about what the parent observed or changed, not as an exhaustive dependency graph and not as evidence that an observed file was reconciled correctly.
2. Run one independent read-only reviewer in the current workspace. For lightweight reviews, prefer `background_process` with a separate `pi -ne` process rather than reviewing in the parent model. Include the task review packet in the reviewer prompt and keep the reviewer in the same project cwd so it sees the final working tree.
3. Tell the reviewer to inspect the final project state for concrete contradictions or stale related artifacts caused or exposed by this task. Start from `changedDuringTask`, `mutated`, and `observed`, then search nearby project artifacts when warranted. Relevant relationships commonly include implementation ↔ documentation, implementation ↔ tests, API ↔ schema/examples/clients, configuration ↔ docs/examples, model ↔ migrations, and behavior ↔ comments or generated contracts.
4. Do not infer consistency merely because a file was read after another file changed. Re-read whatever is necessary and compare the actual final contents and behavior. Conversely, do not report an unchanged file merely because it was consulted; report only a concrete inconsistency, a specific unresolved uncertainty that cannot be checked, or that no concrete inconsistency was found.
5. The reviewer must not edit files. Its result should identify each finding with the affected paths and the conflicting claims or behavior. Keep speculative architecture advice, stylistic preferences, general code quality criticism, and unrelated bugs out of this review.
6. Record the independent result with `verify.record` using provenance `review_agent`. Mark it failed when a concrete consistency finding remains unresolved; mark it passed when the reviewer found no concrete inconsistency. Review evidence is supporting context and never replaces the executable checks required by `task.finish`.
7. If a valid finding requires changes, fix it in the parent workspace, rerun the relevant executable checks, and repeat the consistency review when the repair could have changed another related artifact.

A consistency reviewer answers one narrow question: after this task, does the project still agree with itself?
