# Pi Kit

A collection of Pi extensions and reusable agent skills for planning, collaboration, background work, and project-aware automation.

## Installation

```sh
pi install git:github.com/halqme/pi-kit
```

## What's included

### Extensions

The `extensions/` directory is a bun workspace. Pi discovers each extension from its `index.ts` entry point.

| Extension | Purpose | Documentation |
| --- | --- | --- |
| [`agent-team`](extensions/agent-team/) | Run session-scoped teams of Pi agents for committee discussion or adversarial review. | [`README.md`](extensions/agent-team/README.md) |
| [`background-process`](extensions/background-process/) | Start, inspect, and stop durable background shell commands. | [`README.md`](extensions/background-process/README.md) |
| [`grill-plan`](extensions/grill-plan/) | Use an evidence-first, approval-gated planning workflow before implementation. | [`README.md`](extensions/grill-plan/README.md) |

See the individual README files for commands, lifecycle details, and extension-specific constraints.

### Skills

Reusable agent workflows live under `skills/`. They cover implementation, diagnosis, review, verification, research, performance work, safe operation, Git workflows, removing low-value generated output, maximum-effort quality work (`l99`), OODA-based uncertainty control (`ooda`), and repository-conforming scaffolding (`scaffold`). Standard subagent delegation is provided by the installed `pi-subagents` package; `agent-team` remains the higher-level committee/review layer.

## Requirements

- Node.js `>=24.0.0`
- bun `>=1.3.14`

## Development

Install dependencies and run the full workspace check from `extensions/`:

```sh
cd extensions
bun install
bun check
```

The check runs strict TypeScript checks and Node test-runner tests for each package that defines a `check` script. Other useful workspace commands are:

```sh
bun typecheck
bun test
```

To work on one extension, run its development or smoke command from `extensions/`:

```sh
bun --filter @halqme/agent-team dev
bun --filter @halqme/agent-team smoke
```

Replace the package name to target another extension. After changing an extension loaded by Pi, run `/reload` in the Pi session.

## Repository layout

```text
.
├── extensions/   # Pi extensions and bun workspace configuration
├── skills/       # Reusable agent workflows
├── settings.json # Agent settings
└── AGENTS.md     # Workspace working principles
```

This workspace is intended to be used by Pi; extension behavior and usage are documented in each extension's README.
