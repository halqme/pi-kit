---
name: apply-correction
description: Use this skill when revising persistent artifacts after factual corrections, review feedback, rejected alternatives, or changed requirements, especially when the final code comments, documentation, prose, or generated text should describe only the resulting current state. Preserve historical contrast when the artifact itself is a changelog, migration guide, comparison, rationale, or other history-sensitive document.
---

# Apply Correction

Treat correction history as reasoning input and the artifact as a description of the resulting state. Resolve the correction fully, then render from the resolved state rather than from the correction dialogue.

## Workflow

1. **Resolve in scratch space.** Before editing the artifact, explicitly work through the correction, rejected interpretation, or superseded wording. This scratch output may use direct contrast and may name discarded content as often as needed. Its purpose is to finish the correction process, not to provide reusable prose.
2. **Materialize the current state.** Convert the resolution into a compact authoritative representation of what is true now: facts, behavior, interfaces, invariants, requirements, relationships, or intended wording. Represent the resulting state rather than summarizing the conversation that produced it.
3. **Cross a context boundary when possible.** Render the artifact in a fresh model call, child agent, or equivalent isolated context. Pass the authoritative current state, the minimum source context needed to place the edit, and the artifact's purpose and style. Keep the scratch correction discussion on the reasoning side of the boundary.
4. **Render the affected artifact from the current state.** Write for a reader encountering the present system or fact directly. For comments, describe current behavior, intent, invariants, or useful rationale. For documentation and prose, state the resulting facts and relationships. Preserve unrelated surrounding material when editing an existing artifact.
5. **Review for correction residue.** Read the result as a reader who never saw the correction. Any remaining contrast, rejected alternative, previous interpretation, or conversational aside must contribute information that the artifact itself needs. When it exists only because of the editing history, reconstruct that passage from the authoritative current state and review again.

## Materializing current state

Treat the correction history like an event log and the authoritative state like its materialized view. The renderer needs the materialized view; the event log belongs to the correction phase.

Prefer structured state when it reduces accidental carry-over. Use the smallest representation that preserves the semantics needed for the artifact, for example a set of facts, an interface contract, a behavior table, or a compact object.

A useful test is: **would this representation make complete sense to someone who never saw the correction?** If so, it is suitable renderer input.

## Context boundary

A genuine fresh context is the default when the harness supports it because it removes discarded wording from the renderer's immediate generation context.

When isolation is unavailable, first write the authoritative current state as a distinct scratch result. Then rewrite the affected artifact region using that state as the semantic source and perform the residue review as a separate pass.

## History-sensitive artifacts

Some artifacts are specifically about change or contrast. Changelogs, migration guides, compatibility notes, comparisons, deprecation notices, and design rationales may need previous states or rejected alternatives because those facts are part of the subject.

In those cases, retain the history required by the reader and still apply the workflow to incidental correction residue. The criterion is whether the contrast describes the domain or merely records how the agent was corrected.

## Completion criteria

Finish when all of the following hold:

- The artifact agrees with the authoritative current state.
- A reader can understand the affected passage without access to the correction conversation.
- Remaining historical or contrastive language serves the artifact's subject.
- The final wording would remain materially the same if the scratch correction dialogue were discarded before rendering.
