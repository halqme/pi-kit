---
name: scaffold
description: Safely create a minimal repository-conforming file structure by discovering existing conventions, generators, interfaces, tests, and validation commands before writing files.
---

# Scaffold

Use this skill when creating the initial structure for a module, feature, service, CLI, package, or similar repository artifact. It is for structure and wiring, not for inventing a new architecture or filling unfinished business logic with placeholders.

## Workflow

1. Inspect the repository instructions, existing tree, analogous modules, official generators, templates, naming conventions, package manager, configuration, exports, and test placement. Check whether the requested structure already exists.
2. Identify the smallest target tree and its public interfaces. Reuse an existing generator or template when one is available instead of hand-writing equivalent output. State assumptions and distinguish generated files from intentionally omitted files.
3. Before broad generation or any possible overwrite, present the target paths, relevant existing paths, and intended changes. Do not silently overwrite existing files; follow `operate-safely` for destructive or externally consequential actions.
4. Create only the required directories and minimal files. Follow repository formatting, module conventions, dependency boundaries, and configuration patterns. Do not add new dependencies, abstractions, or architecture without evidence and authorization.
5. Add the smallest meaningful test or smoke check needed to prove that the scaffold is wired correctly. Do not fill business logic with large TODO blocks, fake implementations, or misleading success paths.
6. Run the repository's formatter, typecheck, lint, and narrow smoke or test commands when applicable. Start with the smallest useful checks and report unavailable checks rather than inventing replacements.
7. Review the generated tree and diff for accidental files, implicit overwrites, incorrect exports, missing configuration, unnecessary dependencies, and divergence from the nearest existing pattern. Report generated artifacts and intentionally unimplemented areas.

## Boundaries

- Existing repository conventions and generators outrank generic preferences.
- Scaffolding must remain minimal and reversible. A request for structure does not authorize implementation of unspecified behavior.
- Preserve existing files and user changes. Stop and ask before making a material scope, interface, dependency, or trust-boundary decision that cannot be resolved from repository evidence.
- `operate-safely`, `verify-work`, and applicable implementation or review skills remain authoritative; this skill does not weaken their checks or approval requirements.
