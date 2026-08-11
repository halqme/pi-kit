---
name: implement-change
description: Implement, modify, refactor, or remove code, configuration, tests, or documentation. Use when the user asks Pi to build something, change behavior, fix an identified issue, clean up code, or otherwise edit project artifacts. Do not use for review- or diagnosis-only requests.
---

# Implement a Change

1. Inspect the request, applicable instructions, current diff, source-of-truth documents, relevant implementation, tests, and project commands.
2. State the intended outcome and acceptance criteria. Identify material uncertainty, affected surfaces, and approval boundaries; for non-trivial work, give a brief implementation and verification plan before editing. Before choosing direct execution, if the user asks to delegate or the task has multiple independently verifiable workstreams, load `delegate-task` and hand off a self-contained workstream while keeping design decisions and final verification with the parent.
3. Choose the smallest coherent change. When uncertainty is material, state genuinely competing hypotheses with their supporting and contradicting evidence, then choose a falsifiable experiment or change that is safe and reversible. State the predicted outcomes, stop conditions, and what will change if the result supports or rejects the hypothesis. Do not manufacture alternatives when the evidence is already sufficient.
4. Execute only the selected action, respecting `perform-safely` and any approval boundary. Implement in the project's existing style and preserve behavior, interfaces, validation, error handling, and compatibility unless the request requires otherwise.
   - When an existing source file is written in a language supported by a structural syntax tool such as Astrolabe, use that tool as the primary path for inspection and local edits, regardless of change size. Begin with its structural overview, drill into only the needed nodes, and decompose large changes into a sequence of local edits so intermediate states can be inspected.
   - Reuse still-valid node handles and broader structural results to avoid redundant inspections. After each structural edit, refresh handles or inspect again when the edit may have changed surrounding structure. Use ordinary diff/edit tools for new files, unsupported or non-structural files, generated artifacts, configuration, or cases where structural editing provides no useful leverage.
   - When adding, modifying, or reviewing source comments, follow [the comment and documentation guidance](./references/comments.md). Distinguish implementation comments that bind code to independently verifiable external constraints from documentation comments that describe an API for humans and tooling.
5. Update tests and documentation when the externally observable behavior, contract, or operating procedure changes.
6. Run the narrowest relevant checks first, then broader checks proportionate to risk. Inspect full failures, warnings, skipped cases, and truncation; fix causes rather than suppressing signals. Record actual results and use new evidence to resolve material uncertainty rather than repeating unchanged actions.
7. Review the resulting diff for scope, accidental changes, stale comments, secrets, missing coverage, inconsistent style, type-system escapes, abnormal defensive code, and obvious performance or resource regressions.
8. Before claiming the work is finished, apply `assess-task-completion` to evaluate the requested outcome against the actual resulting state and evidence.

Stop and ask before a choice that materially changes product behavior, public interfaces, data, dependencies, or external state and cannot be resolved from project evidence.

## Trigger and contract

Use when the user requests an implementation, modification, refactor, removal, or documentation/configuration change. Do not edit for diagnosis or review-only requests. Input is the request plus repository evidence; output is the smallest coherent change with relevant verification evidence. Completion itself is evaluated by `assess-task-completion`. Stop before editing when scope, approval, compatibility, or a competing hypothesis remains materially unresolved.
