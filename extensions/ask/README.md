# ask

`ask` is a synchronous human-interaction primitive for Pi's interactive TUI. It lets the model present one or more structured questions in one form and receives the submitted answers as a tool result rather than synthesizing user messages.

Supported question types:

- `single` — exactly one option when required
- `multiple` — bounded multiple selection
- `confirm` — explicit Yes/No returning a boolean
- `allowOther` — optional free-text value attached to `single` or `multiple`

Question IDs are generated per call as `q_1`, `q_2`, and so on. No option is preselected. Escape returns `{ "status": "cancelled" }`; Ctrl+Enter validates and submits the form.

The tool intentionally does not implement dynamic branching, next-action suggestions, rankings, defaults, or general-purpose forms. `ctx.ui.custom()` is TUI-only, so `ask` rejects RPC, JSON, and print mode rather than silently degrading into a different interaction model.
