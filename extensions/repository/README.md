# repository

Repository intelligence and structural mutation for Pi Kit.

The extension exposes exactly two tools:

- `context`: read-only repository acquisition. `find` performs passage-level relevance ranking; `locate`, `search`, `inspect`, and `inspect_many` use Tree-sitter plus optional LSP evidence.
- `code`: structure-aware mutation. `edit` replaces a validated syntax node and `rename` applies a language-server workspace edit with staleness and syntax checks.

The two surfaces intentionally share one structural engine instance, so opaque continuations returned by `context` are valid inputs to `code` in the same session. Conceptual retrieval and structural retrieval are implementation strategies behind `context`, not separate tools the model must route between.

Generated files, configuration, unsupported languages, and new files remain ordinary file-editing territory. Repository text returned by `context` is data, not instructions.

Checks:

```sh
bun run --cwd extensions/repository check
```
