# D2 Conventions for Work Diagrams

Use these conventions to keep temporary work diagrams small, readable, and semantically neutral.

## Node shapes

- **Process**: default shape for an action or work step.
- **Decision**: `shape: diamond` for a meaningful choice, approval, or condition.
- **Artifact**: `shape: document` for a produced or reviewed file, report, or other deliverable.
- **External actor**: `shape: person` for a human, service, or other participant outside the model's direct control.

Choose a shape for meaning, not decoration. Do not encode project-specific architecture in styling.

## Edges

- Use solid edges for execution order or dependency.
- Label branch edges with the condition or outcome, such as `approved` or `concerns`.
- Use an edge back to an earlier node for a feedback or revision loop.
- Show parallel work with separate outgoing edges from a common prerequisite and converging edges at the next dependent step.
- Omit edges that do not clarify order, dependency, branching, or feedback.

## Composition

- Prefer 5–12 nodes; split or omit detail rather than producing a dense diagram.
- Give nodes short, action-oriented labels.
- Include only the major actors, steps, states, decisions, artifacts, and dependencies already present in the textual model.
- Make the review or approval point explicit when one exists.
- Keep verification and failure/revision paths visible when they affect whether work can proceed.
- Avoid styling, icons, or layout directives unless they materially improve readability.
