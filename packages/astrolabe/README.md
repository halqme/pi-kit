# Astrolabe

Astrolabe provides language profiles, Tree-sitter parsing, and LSP client services for source files. It is host-agnostic and exposes its API from `@halqme/astrolabe`.

The package owns the supported-language grammars and queries, parser lifecycle and cache, and language-server process management. Host-framework tools and repository workflows belong to the consumer.

Run the package tests with:

```sh
bun run --cwd packages/astrolabe test
```
