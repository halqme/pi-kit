# Pi Extensions Workspace

Global Pi extensions live in one Bun workspace. Pi auto-discovers each `<extension>/index.ts` directory. Every extension is an independent package with its own dependencies, scripts, tests, TypeScript configuration, and documentation.

```text
extensions/
├── package.json
├── bun.lock
├── tsconfig.json
├── agent-team/
│   ├── package.json
│   ├── index.ts
│   ├── rpc-client.ts
│   ├── team.ts
│   ├── rpc-client.test.ts
│   ├── team.test.ts
│   └── README.md
├── background-process/
│   ├── package.json
│   ├── index.ts
│   └── README.md
├── grill-plan/
│   ├── package.json
│   ├── index.ts
│   ├── utils.ts
│   ├── utils.test.ts
│   └── README.md
```

Run from this directory:

```sh
bun install
bun run check
bun run --filter @halqme/agent-team dev
bun run --filter @halqme/background-process dev
bun run --filter @halqme/grill-plan dev
```

`bun run check` recursively runs each package's strict TypeScript checks and Node test-runner tests. Pi loads this global directory automatically; use `/reload` after changes.
