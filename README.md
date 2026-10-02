# Pi Kit

A personal collection of extensions and skills for [Pi](https://github.com/badlogic/pi-mono).

## Contents

- **Railway** — `delegate`, `repository`, and `task` extensions, plus the `consistency-review`, `git-workflow`, and `implement-change` skills.
- **Browser Inspector** — structured inspection of a running web UI. Requires Bun and a Chrome-compatible browser when used.
- **macOS Talk** — runs AppleScript and JXA through `osascript` on macOS.

## Install

This repository uses Bun workspaces and Bun's `catalog:` dependency syntax. Configure Pi to use Bun for package installation by adding this to your Pi settings:

```json
{
  "npmCommand": ["bun"]
}
```

Then install the package:

```sh
pi install git:github.com/halqme/pi-kit
```

## Development

Install dependencies, run all tests, and run the full checks with Bun:

```sh
bun install
bun run test
bun run check
```

`bun run test` runs each package with its configured test runner. `bun run check` also runs linting and typechecking.
