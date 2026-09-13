# repository

Repository intelligence and structural mutation for Pi Kit.

The extension exposes two repository tools and transparently strengthens the built-in editor:

- `context`: read-only repository acquisition. `find` performs passage-level relevance ranking; `locate`, `search`, `inspect`, and `inspect_many` use Tree-sitter plus optional LSP evidence.
- `code`: structure-aware mutation. `edit` replaces a validated syntax node and `rename` applies a language-server workspace edit with staleness and syntax checks.
- `edit`: the built-in exact-text editor is overridden so single replacements in supported source files use the same syntax validation automatically. Unsupported files and multi-edit calls retain the built-in behavior.

The repository tools and editor integration intentionally share one structural engine instance, so opaque continuations returned by `context` are valid inputs to `code` in the same session. The automatic `edit` route makes that validation effective even when the model selects the built-in editor directly. Conceptual retrieval and structural retrieval are implementation strategies behind `context`, not separate tools the model must route between.

The automatic editor route is based on the supported language extension, so source-based configuration and generated files are validated like other supported source. Unsupported languages and new files remain ordinary file-editing territory. Repository text returned by `context` is data, not instructions.

Checks:

```sh
bun run --cwd extensions/repository check
```
