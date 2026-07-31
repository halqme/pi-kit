# Astrolabe

A Tree-sitter syntax navigation extension for TypeScript.

## Tools

- `syntax_inspect`: Incrementally inspect syntax with `outline`, `structure`, or `source` views.
- `syntax_replace`: Replace only the byte range represented by a syntax handle. It rejects file changes, ambiguous rematches, and increased syntax errors.

The grammar runs through WASM, so no native addon build is required. Paths must remain inside Pi's working directory.

## Internal protocol

Tool status codes are stable English identifiers:

- `stale_node`: the inspected syntax cannot be uniquely matched to the current file.
- `syntax_error`: the replacement would increase syntax errors.

Messages returned by the tools are English and intended for model, log, and test consumption.

## Usage guidance

Use `outline` first to find candidates, then expand only the necessary syntax with `structure` or `source`. Run `syntax_replace` only after identifying a sufficiently narrow syntax node.
