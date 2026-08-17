# browser_inspector

`browser_inspector` gives Pi structured access to a running web UI. It is intended for short edit-render-observe loops where source code, generated CSS, or HTTP responses are not enough to prove what the browser actually rendered.

The Pi extension itself runs on Node.js. Browser work is delegated over a JSONL stdin/stdout protocol to a persistent Bun sidecar, which owns `Bun.WebView` with the Chrome backend. The sidecar always starts an isolated headless Chrome (`url: false`, ephemeral storage); it does not attach to the user's normal browser session. Bun and an installed Chrome/Chromium/Edge/Brave-compatible executable are therefore runtime requirements only when this tool is used.

## Actions

- `probe` checks that the Bun sidecar and Chrome backend can start and reports browser/runtime capabilities.
- `open` opens a URL in a fresh isolated page. The default viewport is 1440x900.
- `inspect` resolves a CSS selector, viewport point, or existing element ref and returns DOM attributes, text, visibility/focus/enabled state, and its rendered box. At most 20 matches are materialized per call.
- `styles` reports computed CSS together with matched declarations and custom properties referenced without fallbacks. The default `layout` preset keeps responses focused; `typography`, `paint`, `all`, or an explicit property list are available.
- `screenshot` captures the viewport or one target to PNG. Without `path`, the Node extension allocates a temporary file outside the project.
- `interact` supports `click`, `type`, `press`, `scroll`, `resize`, `reload`, `back`, and `forward` for reproducing UI states before inspection.
- `console` and `network` expose cursor-based event buffers so repeated checks can request only events newer than a previous result.
- `close` destroys the current page. The Bun sidecar itself is disposed when the Pi session shuts down.

## Typical call sequence

Open the page, inspect a target, then reuse the returned ref:

```json
{"action":"open","url":"http://127.0.0.1:5173"}
{"action":"inspect","target":{"selector":"button[aria-label=\"Save\"]"}}
{"action":"styles","target":{"ref":"e4"},"preset":"layout"}
```

`inspect` and `styles` require a nested `target` (`selector`, `ref`, or `point`); a top-level `selector` is not a target.

## Element refs

`inspect` returns opaque refs such as `e4`. Reuse them for `styles`, `screenshot`, or `interact` rather than repeatedly reconstructing fragile selectors. Refs belong to one document generation and are deliberately invalidated by navigation or reload. If a framework replaces a DOM node, the old ref also fails instead of silently resolving to a different element.

## CSS diagnosis

`styles` combines Chrome's computed style and matched-rule views. This makes failures visible when a class and its generated rule exist but the declaration does not become an effective style. For example, a rule such as `padding-inline: calc(var(--spacing) * 4)` can be reported alongside `--spacing: unset`, rather than treating the presence of `.px-4` in generated CSS as proof that padding was applied.

## Boundaries

Raw CDP is intentionally not part of the Pi tool API. The Bun host uses CDP internally for DOM, CSS, Page, Runtime, and Network observations while exposing stable, task-level operations to the model. Add a structured browser action when a recurring observation is missing instead of teaching callers to assemble protocol commands themselves.

`Bun.WebView` is experimental, so the JSONL host boundary also isolates Pi from Bun API churn. The browser tool should not manage dev servers or other long-running commands; use `terminal` when browser checks depend on readiness or startup/failure output, and use `background_process` only when no readiness observation is needed.
