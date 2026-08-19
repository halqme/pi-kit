---
name: git-workflow
description: Perform Git repository operations involving commits, branches, merges, rebases, tags, remotes, pushes, or pull-request preparation. Use when the user asks Pi to alter Git history or refs, publish changes, resolve a merge or rebase, prepare commits, or carry out a Git workflow, or when applicable repository instructions authorize a default commit after completed work. Do not use merely for read-only status, diff, log, blame, or show inspection during another task.
---

# Manage Git

1. Confirm the requested outcome and inspect the repository root, status, current branch, `HEAD`, upstream, relevant diff, remotes, and applicable instructions before mutating Git state. Treat this snapshot as the baseline for post-operation verification.
2. Separate user changes by logical concern. Resolve the exact paths and refs in scope, distinguish staged, unstaged, and untracked changes, and never stage, commit, discard, reformat, or rewrite unrelated work.
3. Explain and obtain approval before destructive or difficult-to-recover operations, including history rewrites, forced updates, cleaning files, or discarding changes. Never run `git reset --hard` or `git clean` without explicit approval for that exact action.
4. Commit completed work when the user requests it or applicable repository instructions authorize the default commit, unless the user explicitly says not to commit, to leave changes uncommitted, or to defer the commit. Only push, merge, rebase, create or delete branches or tags, or open pull requests when explicitly requested. Never commit unrelated work or create a commit when the target scope is ambiguous. Prefer non-interactive commands, path-limited staging or commits when unrelated changes exist, and avoid force-push; if explicitly approved, use the safest applicable lease protection.
5. Before committing, inspect the exact staged diff and run checks proportionate to the staged change, including `git diff --check` when applicable. Confirm that sensitive-looking and generated paths are intentionally included, and do not overwrite changes from another session or user. Keep each commit to one logical concern and follow repository commit conventions. Commits made by the Agent must disable signing for that invocation with `-c commit.gpgSign=false` and `--no-gpg-sign`; do not change the user's persistent Git signing configuration. Add `Co-authored-by: Pi <agent@pi.dev>` to commits created by Pi by default. Omit it only when the user explicitly requests no Pi co-author.
6. Adversarially verify the operation before and after execution: check that the resolved commit, branch, upstream, remote, and included paths are exactly the intended targets; inspect for omitted, unrelated, generated, or sensitive files; and confirm the expected working-tree state. Do not report success from the command exit code alone.
7. Report the resulting refs or commits, commands and checks that materially establish success, anything intentionally left uncommitted or unpublished, and recovery guidance when relevant.

Read-only Git commands are evidence-gathering tools and may be used without this workflow. Git hosting actions remain externally visible even when the underlying Git command is reversible.

## Trigger and contract

Use when the user explicitly requests a Git operation that changes history, refs, remotes, or a pull request, or when applicable repository instructions authorize a default commit after completed work. Do not use for read-only status, diff, log, blame, or show inspection. Input is the exact requested ref operation and its scope; output is the verified resulting refs and working-tree state. Stop before mutation when the target, approval boundary, or included paths are ambiguous.
