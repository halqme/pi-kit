# Pi Extensions Workspace

Pi extensions live in one Bun workspace. Pi auto-discovers each `<extension>/index.ts` entry point. Every extension is an independent package with its own dependencies, checks, and documentation; see the extension's README for its behavior and constraints.

Run from this directory:

```sh
bun install
bun run check
bun run --filter <package-name> dev
bun run --filter <package-name> smoke
```

`bun run check` runs each package's TypeScript checks and tests. The `dev` and `smoke` scripts run one selected extension through Pi. After changing an extension already loaded by Pi, use `/reload`.
