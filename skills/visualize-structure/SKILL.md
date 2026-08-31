---
name: visualize-structure
description: Visualize architecture, workflows, state transitions, dependencies, control or data flow, and other relational structure with D2. Use when a diagram would materially reduce ambiguity, expose topology, or make a structural decision easier to inspect. Do not diagram information that is already clear in text or create diagrams merely because a task is complex.
---

# Visualize Structure

Use diagrams as temporary externalized structure for reasoning and communication. Optimize for human comprehension, not graph-theoretic completeness.

D2 is the default diagram language because it keeps source compact and delegates layout. The diagram is the artifact; D2 syntax is only the backend.

## Decide whether to diagram

Diagram only when relationships matter more than a linear explanation. Good targets include:

- architecture and component boundaries;
- dependency and ownership graphs;
- workflows and task loops;
- state machines and transitions;
- control flow and data flow;
- before/after structural comparisons.

Do not diagram information that is already obvious from text. A complex task does not automatically need a diagram.

## Compose around one narrative

1. State the question the diagram must answer.
2. Choose one primary visual narrative before adding supporting relationships.
3. Build the smallest skeleton that communicates that narrative.
4. Add secondary relations only when they change interpretation.
5. Remove information that competes with the primary flow.

Prefer a primary flow with supporting edges over every known relationship with equal visual weight. Correct but irrelevant relationships are noise.

Secondary relations must remain visually secondary:

- do not let supporting I/O determine the overall geometry;
- prefer summarizing bidirectional interaction over drawing both directions;
- omit edges whose direction is already obvious from labels;
- separate orthogonal concerns into another diagram instead of forcing them into one graph.

## Topology

Optimize the representation for comprehension, not literal topology.

- Hierarchical layouts work best when the primary narrative is acyclic.
- Do not encode a feedback loop as a long literal back-edge when a local `retry`, `continue`, `revise`, or loop marker communicates the same idea.
- Duplicate or summarize a boundary when doing so removes distracting cross-diagram edges.
- Do not leave semantically meaningful ordering to the layout engine. If order matters, encode the relation or collapse the items into one labeled node.
- Removing information is a valid and often preferred fix.

## Layout

Choose the layout engine deliberately.

- Prefer ELK for non-trivial hierarchical workflows, dependency graphs, and diagrams with containers.
- Use Dagre when the graph is small and simple.
- Use TALA when different containers genuinely require different flow directions.
- Do not assume nested `direction` affects Dagre or ELK.

Choose the overall direction from the reading task, not habit. Prefer a normal document-friendly aspect ratio over a very wide or very tall canvas unless the content requires it.

## Render and inspect

For a meaningful visualization, do not stop at syntactically valid D2.

1. Write the smallest useful temporary `.d2` source.
2. Render it with the selected layout engine, for example:

   ```sh
   d2 --layout=elk diagram.d2 diagram.svg
   ```

3. Inspect the rendered result as an image, not only the source.
4. Revise the structure, information density, or layout when the result is hard to read.
5. Repeat until the primary narrative is obvious at normal viewing size.

Treat rendering as falsification. Revise when:

- the aspect ratio makes normal viewing difficult;
- the primary flow is not immediately apparent;
- long edges cross most of the diagram;
- edges cross unnecessarily;
- secondary relations dominate the geometry;
- containers dominate their contents;
- labels become unreadably small at fit-to-screen size;
- the layout engine chooses an order that implies the wrong meaning.

If D2 cannot be rendered or the result cannot be inspected, say that the diagram source is unvalidated rather than claiming visual quality.

## Output and lifecycle

Keep temporary diagrams disposable. Do not commit generated `.d2`, SVG, or PNG files unless the user requested documentation or the diagram is itself a project artifact.

When a persistent diagram is requested, keep the D2 source as the authoritative editable form and generate rendered formats from it. Prefer one focused diagram over a comprehensive diagram that requires explanation before it can be read.
