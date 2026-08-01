---
name: nushell
description: Write, review, debug, and explain Nushell (nu) commands and .nu scripts. Use for structured pipelines, types, closures, paths and globs, quoting, external commands, configuration, and Bash/Zsh-to-Nushell translation, especially when shell-looking syntax may invite incorrect POSIX-shell assumptions. Do not treat ordinary POSIX shell code as Nushell without confirming the execution boundary.
compatibility: Works with Pi and other Agent Skills-compatible harnesses. Runtime verification requires a local Nushell executable.
---

# Nushell

Treat Nushell as a structured-data programming language that also acts as a shell. Do not mechanically translate Bash, Zsh, Fish, or POSIX-shell syntax.

## Required workflow

1. Establish the execution boundary.
   - Determine whether the code runs directly in Nushell, from another shell via `nu -c`, or from a `.nu` script.
   - Keep outer-shell quoting separate from Nushell quoting. A command such as `bash -c 'nu -c "..."'` has two parsers.

2. Establish the version when execution is available.

   ```sh
   nu --version
   ```

   Nushell evolves quickly. Do not assume remembered syntax is current.

3. Inspect local help before guessing flags, signatures, or accepted types.

   ```sh
   nu -n -c 'help glob'
   nu -n -c 'glob --help'
   ```

   Prefer local help for the installed version. Use current official Nushell documentation when local help is unavailable or a language-level rule needs confirmation.

4. Reduce the problem to a minimal reproducer and execute it when possible.

   ```sh
   nu -n -c '<minimal pipeline>'
   ```

   `-n` (`--no-config-file`) avoids user configuration affecting the result. For a script, parse-check it before running:

   ```sh
   nu -n -c 'nu-check --debug path/to/script.nu'
   nu -n path/to/script.nu
   ```

5. Inspect values and types at uncertain pipeline boundaries.

   ```nu
   <expression> | describe
   <expression> | to nuon
   ```

6. Report whether the final snippet was actually executed. Include the tested Nushell version when known. Never present an untested guess as verified code.

## Semantic model

- Nushell pipelines normally carry typed values: strings, lists, records, tables, paths, dates, durations, and other values. They are not merely byte streams.
- Expressions return values implicitly. Use `print` only for an intentional display side effect.
- One expression has one result value. A list or table is still one value.
- Nushell parses much of a pipeline before execution, so quoting and argument types can change meaning before runtime.
- Internal Nushell commands and external programs have different semantics. External programs still consume command-line arguments and streams.

When explaining a nontrivial pipeline, identify the value type flowing through each important stage.

## Core syntax reminders

Use Nushell syntax, not POSIX-shell syntax:

```nu
# Variable and environment variable
let name = 'Miharu'
$env.EDITOR = 'nvim'

# Command substitution
let files = (glob '*.nu')

# String interpolation
$"Hello, ($name)"

# List and closure
[1 2 3] | each {|n| $n * 2 }

# Record and table-oriented filtering
ls | where type == file | select name size modified
```

Do not substitute the following POSIX forms without redesigning them:

- `$(command)` → use `(command)`.
- `$HOME` → use `$env.HOME` for an environment variable.
- Implicit word splitting → use a list and the spread operator deliberately.
- Text parsing of structured Nushell output → keep records/tables structured and use `get`, `select`, `where`, `each`, or `update`.
- Shell functions and `test` syntax → use `def`, typed parameters, expressions, and `if`.

## Globs: mandatory distinctions

Distinguish all three concepts:

1. A glob pattern/literal.
2. The `glob` value type.
3. The `glob` command, which searches the filesystem and returns a list of fully qualified path strings.

Never assume parentheses or whitespace combine several glob expressions. The `glob` command accepts one glob expression per invocation.

### One pattern with alternatives

Use brace alternatives when the paths share a useful prefix:

```nu
glob "/Users/hal/.pi/agent/{prompts/*.md,skills/*}"
```

This is one glob expression with two alternatives. Parenthesized, space-separated text is not an alternative-list syntax:

```nu
# Invalid assumption: this is still one malformed pattern
glob '(/a/*.md /b/*)'
```

### Several independently constructed patterns

Use a list, convert dynamic strings to `glob`, invoke once per pattern, then flatten:

```nu
let patterns = [
    '/Users/hal/.pi/agent/prompts/*.md'
    '/Users/hal/.pi/agent/skills/*'
]

$patterns
| each {|pattern| glob ($pattern | into glob) }
| flatten
```

Do not add `each {|path| print $path }` merely to display results. Returning the list is normally enough. Add `print` only when a side effect is required inside a larger operation.

### Quoting differs by context

For filesystem commands such as `rm`, `cp`, `mv`, `open`, and `ls`, a quoted wildcard may be treated literally, while a bare or backtick-quoted glob can expand. For a programmatically created pattern, use `into glob` explicitly:

```nu
let pattern = $"*(date now | format date '%Y-%m')*"
ls ($pattern | into glob)
```

The dedicated `glob` command is designed to parse a glob expression and supports richer patterns. Do not generalize its examples to every filesystem command without checking the target command's signature.

Before destructive glob operations, preview the exact matches:

```nu
let matches = (glob '*.tmp')
$matches
# Only after inspection:
# rm ...$matches
```

## External commands

Pass external command arguments as values, not by constructing a shell command string.

```nu
let args = ['status' '--short']
^git ...$args
```

Use `^` when it is necessary to force external-command resolution. Use `%` when it is necessary to force an internal Nushell command.

To capture an external program's status and streams as a record, use `complete`:

```nu
let result = (do { ^git status --short } | complete)

if $result.exit_code != 0 {
    error make {msg: $result.stderr}
}

$result.stdout
```

Do not silently insert `sh -c`, `bash -c`, or `zsh -c`. That reintroduces another shell parser and changes quoting, expansion, portability, and security properties. Use it only when the user explicitly needs POSIX-shell evaluation.

## Diagnostic playbook

### Parse error

- Isolate the smallest failing expression.
- Check whether parentheses were incorrectly used as grouping or collection syntax.
- Check list, record, closure, interpolation, and command-substitution delimiters separately.
- Remember that `{|x| ... }` is a closure, `[...]` is a list, and `(...)` evaluates a subexpression.
- Re-run under `nu -n -c`.

### Type mismatch

- Pipe the preceding expression to `describe`.
- Read `help <command>` and inspect its input/output types and parameter types.
- Convert deliberately with commands such as `into string`, `into glob`, `into int`, or `path expand`; do not scatter speculative conversions.

### Unexpected external-command behavior

- Verify whether Nushell resolved an internal command instead of the intended executable.
- Inspect the argument list before spreading it.
- Capture `stdout`, `stderr`, and `exit_code` with `complete`.
- Do not parse an external command's human-formatted output when a machine-readable option such as JSON exists.

### Glob failure

- Test the pattern alone with `glob <pattern>`.
- Confirm whether the value is a `string` or `glob` using `describe`.
- Separate alternative syntax (`{a,b}`) from lists of independent patterns.
- Check quoting at both the outer shell and Nushell layers.

### Works interactively but not in automation

- Compare with `nu -n -c` to detect configuration, aliases, overlays, plugins, or environment conversions.
- Use absolute paths where the current directory is not guaranteed.
- Make required environment variables explicit.

## Translation policy

When converting Bash/Zsh code:

1. State the original intent, not just the original tokens.
2. Redesign around Nushell values and tables.
3. Preserve external-command boundaries where structured replacements do not exist.
4. Avoid emulating text pipelines unnecessarily.
5. Call out behavior that cannot be translated exactly.

Bad approach:

```text
Replace every Bash token with the closest-looking Nushell token.
```

Good approach:

```text
Identify inputs, output types, filtering, error behavior, filesystem effects,
and external commands; then implement those semantics idiomatically in Nu.
```

## Response contract

For Nushell answers:

- Give one idiomatic primary solution.
- Add an alternative only when it has a real tradeoff, such as fixed versus dynamic glob patterns.
- Explain the specific POSIX-shell assumption that would fail.
- State execution status: tested with version X, parse-checked only, or not executed.
- Never invent a command, flag, type conversion, or quoting rule.
- Prefer current official documentation and installed `help` output over memory.
- Keep code formatted according to Nushell conventions: readable multiline pipelines, space around `|`, snake_case variables, kebab-case command names, and no unnecessary commas in lists.

## Trigger and contract

Use when writing, reviewing, debugging, explaining, or translating Nushell code. Do not treat shell-like syntax as Nushell merely because the request mentions a terminal. Input is the execution boundary, Nushell version when available, and the code or intent; output is one idiomatic solution with its type and error behavior explained. Stop and label the result untested when `nu` or authoritative local help is unavailable; never present an unexecuted guess as verified.
