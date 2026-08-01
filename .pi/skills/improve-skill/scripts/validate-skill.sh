#!/usr/bin/env bash
set -euo pipefail

skill_dir=${1:-}
if [[ -z "$skill_dir" || ! -d "$skill_dir" ]]; then
  printf 'usage: %s <skill-directory>\n' "$0" >&2
  exit 2
fi

file="$skill_dir/SKILL.md"
if [[ ! -s "$file" ]]; then
  printf 'error: missing or empty %s\n' "$file" >&2
  exit 1
fi

for field in name description; do
  if ! grep -Eq "^${field}:[[:space:]]*[^[:space:]].*$" "$file"; then
    printf 'error: frontmatter field "%s" is missing\n' "$field" >&2
    exit 1
  fi
done

if ! grep -Eq '^---[[:space:]]*$' "$file"; then
  printf 'error: SKILL.md has no YAML frontmatter delimiter\n' >&2
  exit 1
fi

if ! grep -Eiq 'trigger|起動条件|use when|使う' "$file"; then
  printf 'error: no explicit trigger section found\n' >&2
  exit 1
fi

printf 'valid: %s\n' "$skill_dir"
