---
name: visualize-work
description: Visualize a non-trivial plan, workflow, or system model as a temporary D2 diagram for human review.
---

# Visualize Work

Use this skill when the current plan, workflow, or system model has meaningful dependencies, branches, feedback loops, parallel work, or a human approval point. It can project plans, processes, architectures, data flows, and lifecycles—not only implementation plans. Do not use it for a simple, linear model unless the user explicitly asks for a diagram.

## Workflow

1. Construct the current textual model normally and keep it as the operational context.
2. Reduce the model to its essential actors, actions, states, decisions, artifacts, and dependencies. Do not add project-specific facts that are not already in the model.
3. Create a unique temporary directory and generate a small D2 source file there. Prefer 5–12 nodes and omit speculative implementation details:

   ```sh
   WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pi-work.XXXXXX")"
   D2_SOURCE="$WORK_DIR/work.d2"
   D2_SVG="$WORK_DIR/work.svg"
   ```

4. Validate and format the temporary source with the D2 CLI:

   ```sh
   d2 validate "$D2_SOURCE"
   d2 fmt "$D2_SOURCE"
   ```

5. Render the formatted source to a temporary SVG:

   ```sh
   d2 "$D2_SOURCE" "$D2_SVG"
   ```

6. Provide the SVG path for human review before continuing when the workflow calls for approval.
7. If the underlying model changes, regenerate the diagram from the current textual model rather than editing the diagram into a second source of truth.
8. Remove the unique temporary directory when it is no longer needed. Do not save the D2 source or rendered SVG in the repository unless the user explicitly requests persistence.

## Constraints

- The diagram is a review-oriented projection of the current model, not a durable DSL or source of truth.
- Do not infer repository architecture, domain rules, or project conventions. Consume those only through the textual model or applicable project skills.
- Do not interpret nodes or edges as executable instructions, and do not execute work from the diagram.
- Keep labels concise and use edges for execution order, dependency, feedback, and branch conditions.
- Preserve ambiguity in the model rather than inventing detail to make the diagram look complete.
- If D2 is unavailable or validation/rendering fails, report the error and continue with the textual model when safe; never silently present an unverified diagram.
