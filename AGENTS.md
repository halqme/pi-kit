# Pi Kit development contract

Pi Kit targets Node.js 24+ and Bun. The active runtime is the explicit `pi.extensions` / `pi.skills` manifest in `package.json`; do not assume every historical directory is loaded.

Keep changes centered on observable behavior. Tests should explain intended behavior, not preserve implementation accidents. Comments should expose intent, invariants, or external connection points. Commit messages should explain why the change exists.

For existing supported source, use the runtime's `context` tool to acquire the target and `code` for structure-aware mutation when that improves precision. New files, configuration, generated content, and unsupported languages can use ordinary file editing.

Verification should start with the smallest relevant check and expand with change scope. Prefer existing tests, compiler/typechecker/linter output, CI, and structural audits as acceptance evidence. Do not weaken checks to make a change pass.

A normal implementation may be committed after verification unless the user says otherwise. Do not push, merge, rebase, create branches/tags, or publish externally without explicit authorization.
