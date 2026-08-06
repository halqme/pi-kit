# Pi Kit

A collection of extensions, reusable agent skills, prompts, themes, and session analysis tools for [Pi](https://github.com/earendil-works/pi), focused on planning, collaboration, project-aware automation, and safe development workflows.

## Install

```sh
pi install git:github.com/halqme/pi-kit

```

Requirements:

- Node.js 24 or later
- Bun 1.3.14 or later

Recommendation:
- npm:@ollama/pi-web-search

Settings:
```json
{
  "enabledModels": [
    "openai-codex/gpt-5.6-luna:max",
    "openai-codex/gpt-5.6-terra:max",
    "openai-codex/gpt-5.6-sol:high"
  ]
}
```

## Included packages

### Extensions

Pi discovers extensions from the `extensions/` directory. Each extension is an independent Bun workspace package with its own documentation and checks.

See each extension's README for its behavior, tools, hooks, and constraints. Workspace-level commands are covered in the [extension development guide](./extensions/README.md).

### Packages

Additional standalone packages live under `packages/`. See each package's documentation for usage and constraints.

### Skills, prompts, and themes

- Reusable workflows live under `skills/`; each skill is defined by a `SKILL.md` file.
- Prompt templates live under `prompts/`.
- Themes live under `themes/`.

`agent-team` runs its discussion members as isolated Pi subprocesses through the bundled `background-process` extension.

## Development

Install dependencies from the repository root:

```sh
bun install
```

Run all extension checks from the extension workspace:

```sh
cd extensions
bun run check
```

The full check runs strict TypeScript checks and Node test-runner tests for every extension. You can also run one kind of check across the workspace:

```sh
bun run typecheck
bun run test
```

To work on a single extension, use its package name:

```sh
bun --filter @halqme/agent-team dev
bun --filter @halqme/agent-team smoke
```

Replace `@halqme/agent-team` with the target package name. After changing an extension already loaded by Pi, run `/reload` in the Pi session.

## Repository layout

```text
.
├── extensions/   # Pi extensions and Bun workspace configuration
├── packages/     # Standalone packages such as session-metrics
├── skills/       # Reusable agent workflows
├── prompts/      # Prompt templates
├── themes/       # Pi themes
├── package.json  # Pi package metadata
└── bun.lock      # Locked dependencies
```
