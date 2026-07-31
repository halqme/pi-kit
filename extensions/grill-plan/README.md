# Grill Plan

A read-only planning workflow for Pi that mirrors Codex's environment-first, conversational, decision-complete planning flow with explicit approval and tracked execution.

## Commands

- `/plan [task]`: start a new plan
- `/plan execute`: approve the current plan and immediately start its execution turn
- `/plan restore [session-id]`: restore a saved plan by UI selection or session ID
- `/plan refine [feedback]`: revise the current plan
- `/plan status`: show phase and execution progress
- `/plan cancel`: cancel planning or progress tracking

Planning exposes only Pi's file-inspection, conservative read-only Bash, questionnaire, and installed web search/fetch tools. The read-only constraint is added to every planning system prompt and remains active while a completed plan awaits approval. Like Codex Plan mode, the agent first grounds itself in repository evidence, then resolves product intent, then makes the implementation specification decision-complete. It asks only material questions that local inspection cannot answer, usually one at a time and never more than three related questions together. Every final plan contains `課題`, `原因`, `修正するべき点`, `対処法`, `実際に編集するファイル`, and numbered `Plan` sections. Execution begins only after an explicit UI selection or `/plan execute` command.

The extension never creates or updates a project `TODO.md`. It keeps session state in Pi's JSONL and atomically mirrors the current phase, structured plan, and execution progress to `<session-dir>/<session-id>.grill-plan.json`. This JSON sidecar is the sole source of truth. After each successful JSON save, the extension automatically generates a human-readable `<session-dir>/<session-id>.grill-plan.md` sidecar from the same snapshot; Markdown edits are never read back into session state. These sidecars live beside Pi's ignored session files rather than in the project. Starting a new session does not import an old plan automatically; use `/plan restore` to choose one, or `/plan restore <session-id>` to restore it directly. Restoring a planning or executing sidecar immediately starts the appropriate continuation turn, while a ready sidecar remains read-only until explicit approval.

During execution, the agent records each verified step through the `grill_plan_progress` tool. Completing the final step atomically moves the extension out of execution mode, updates the sidecar, removes the progress tool, and reports completion. `[DONE:n]` markers remain supported as a compatibility fallback. Completed plans cannot be replayed with `/plan execute`.

The Bash allowlist is a guardrail, not an operating-system sandbox. Use Pi inside a sandbox or container when plan-mode reads must be mechanically isolated from the host.

The Pi session remains authoritative for ordinary resume behavior. Sidecars provide explicit cross-session restore and are skipped for in-memory sessions. Run `/reload` after editing the extension.
