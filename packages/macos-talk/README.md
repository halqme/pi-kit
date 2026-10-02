# macos-talk

`macos_talk` executes AppleScript or JavaScript for Automation (JXA) directly through macOS `osascript`.

It is intentionally a thin macOS automation boundary rather than a second UI automation DSL. Use the application's scripting interface when available, System Events/Accessibility when GUI scripting is required, and avoid taking foreground focus unless the operation genuinely depends on it.

## Input

- `language`: `applescript` (default) or `javascript` for JXA.
- `script`: the complete script sent to `osascript` on stdin.
- `timeoutMs`: optional timeout; defaults to 30 seconds and is capped at 120 seconds.

## Output

The tool returns canonical JSON containing `ok`, `language`, `stdout`, `stderr`, `exitCode`, `durationMs`, `timedOut`, and `aborted`. If trimmed stdout is valid JSON it is additionally exposed as `value`.

For structured inspection, prefer returning JSON from the script itself. JXA is often convenient for collecting and transforming multiple values while AppleScript is usually more concise for application commands and UI scripting.

## Focus behavior

`macos_talk` does not automatically activate applications or restore focus after arbitrary scripts. The model should prefer, in order:

1. direct application scripting commands that work in the background;
2. System Events / Accessibility actions that do not require activation;
3. temporary activation only when keyboard input, menus, or application behavior requires foreground focus.

Do not add `activate`, `set frontmost to true`, or `keystroke` merely as a generic prelude. Use them only when the requested operation needs them.
