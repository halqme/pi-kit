---
name: implement-change
description: Implement, modify, refactor, or remove code, configuration, tests, or documentation. Use when the user asks Pi to build something, change behavior, fix an identified issue, clean up code, or otherwise edit project artifacts. Do not use for review- or diagnosis-only requests.
---

# Implement a Change

1. Inspect the request, applicable instructions, current diff, source-of-truth documents, relevant implementation, tests, and project commands.
2. State the intended outcome and acceptance criteria. Identify material uncertainty, affected surfaces, and approval boundaries; for non-trivial work, give a brief implementation and verification plan before editing.
3. Choose the smallest coherent change. When uncertainty is material, state genuinely competing hypotheses with their supporting and contradicting evidence, then choose a falsifiable experiment or change that is safe and reversible. State the predicted outcomes, stop conditions, and what will change if the result supports or rejects the hypothesis. Do not manufacture alternatives when the evidence is already sufficient.
4. Execute only the selected action, respecting `operate-safely` and any approval boundary. Implement in the project's existing style and preserve behavior, interfaces, validation, error handling, and compatibility unless the request requires otherwise.
   - When an existing source file is written in a language supported by a structural syntax tool such as Astrolabe, use that tool as the primary path for inspection and local edits, regardless of change size. Begin with its structural overview, drill into only the needed nodes, and decompose large changes into a sequence of local edits so intermediate states can be inspected.
   - Reuse still-valid node handles and broader structural results to avoid redundant inspections. After each structural edit, refresh handles or inspect again when the edit may have changed surrounding structure. Use ordinary diff/edit tools for new files, unsupported or non-structural files, generated artifacts, configuration, or cases where structural editing provides no useful leverage.
5. Update tests and documentation when the externally observable behavior, contract, or operating procedure changes.
6. Run the narrowest relevant checks first, then broader checks proportionate to risk. Inspect full failures, warnings, skipped cases, and truncation; fix causes rather than suppressing signals.
7. Record actual results, including failures and unexpected output, and update the working hypotheses as supported, weakened, rejected, or unresolved. If uncertainty remains, use the new evidence to select the next check instead of repeating an unchanged action.
8. Adversarially challenge the implementation: try boundary and invalid inputs, failure paths, compatibility assumptions, and a plausible counterexample to the acceptance criteria. Add a regression test when it provides durable protection.
9. Review the final diff for scope, accidental changes, stale comments, secrets, missing coverage, style inconsistent with surrounding code, type-system escapes, abnormal defensive code, and obvious performance or resource regressions.
10. Report the outcome, files or behavior changed, verification results, adversarial checks, skipped checks, unresolved hypotheses, and remaining risk.

Stop and ask before a choice that materially changes product behavior, public interfaces, data, dependencies, or external state and cannot be resolved from project evidence.

## Comments and documentation

Treat implementation comments and documentation comments as different interfaces. Do not apply one rule to both.

### Implementation comments: bind code to external constraints

An implementation comment should primarily preserve information that cannot be recovered from the commented code itself. Use it to bind a local implementation choice to an independently verifiable constraint outside that implementation: a protocol or specification, upstream behavior or bug, compatibility requirement, security or data invariant, product rule, measured operational fact, or similar evidence.

State the constraint and why it forces the local choice rather than narrating what the code does. When practical, identify a stable source or verification path. A future agent in a different session should be able to verify the comment without trusting the previous agent's explanation.

If the relevant fact can instead be enforced mechanically by a type, test, assertion, schema, linter, protocol supervisor, or other executable check, prefer that enforcement and keep a comment only when the external reason still needs to be preserved. Remove or update the comment when its constraint no longer applies.

Avoid comments that merely translate nearby code into natural language. Prefer clearer names, structure, types, or extracted operations when the implementation itself can carry the meaning.

### Documentation comments: describe the API for humans and tools

Documentation comments such as JSDoc, rustdoc, Swift documentation comments, and Haddock are part of the API surface consumed through editor hovers, generated documentation, symbol browsers, and similar tooling. They may describe behavior that is also visible in the implementation because their intended reader often does not read the implementation at all.

Document the observable contract needed to use the symbol correctly: purpose, inputs and outputs, errors, preconditions and postconditions, invariants, lifecycle expectations, and usage where useful. Do not require an external constraint merely to justify documentation. Avoid implementation detail unless it affects correct use of the API.

## Trigger and contract

Use when the user requests an implementation, modification, refactor, removal, or documentation/configuration change. Do not edit for diagnosis or review-only requests. Input is the request plus repository evidence; output is the smallest coherent change with updated checks. Stop before editing when scope, approval, compatibility, or a competing hypothesis remains materially unresolved.
