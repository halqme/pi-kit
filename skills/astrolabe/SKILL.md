---
name: astrolabe
description: Guides efficient use of the Astrolabe structural-editing tool for existing TypeScript, JavaScript, Python, and Go source. Use after Astrolabe is available when a task needs syntax-aware inspection or edits; do not use for new, generated, configuration, unsupported, or non-structural files.
---

# Use Astrolabe Efficiently

Use Astrolabe for existing supported source when syntax-aware inspection or safe node replacement is useful. Keep the tool workflow short: every call must reduce uncertainty or perform the approved edit.

## Default workflow

1. Identify the smallest useful target from the request, compiler/lint output, or an existing symbol reference.
2. Prefer `search` when the symbol, function, call, or import is known. Otherwise use `inspect` on the file path for an outline.
3. Select the relevant `next` action and pass it unchanged. Do not inspect every outline candidate.
4. Request source only for the selected target. Do not request unrelated helpers or surrounding declarations unless they are needed to decide the edit.
5. Replace the selected node with the smallest coherent replacement. For multiple changes in one file, collect validated continuations and use `replace_many`.
6. Use the returned `next` only when verification or another dependent edit requires it; do not re-inspect automatically after every successful edit.

## Stop conditions

- A simple local edit should normally complete in two or three Astrolabe calls.
- Stop exploring once the target node, replacement, and required surrounding context are known.
- Do not switch to a full-file read or ordinary edit merely because an Astrolabe call failed; follow its returned `next` recovery action first.
- If the file is new, generated, configuration, unsupported, or the change is not meaningfully structural, use the ordinary tool instead.

## Safe batch edits

Use `replace_many` only when all targets are in the same file and each continuation was obtained from the current source. It validates every target and writes atomically; if any target is stale, overlapping, structurally incompatible, or introduces syntax errors, no target is written. Do not reuse continuations after an edit invalidates them.

## Completion

After editing, run the narrowest project-defined lint, typecheck, or test command that covers the change. Inspect the result and the final diff. Report failed or skipped checks rather than claiming completion beyond the evidence.
