---
name: git-workflow
description: Perform explicit Git repository operations involving commits, branches, merges, rebases, tags, remotes, pushes, or pull-request preparation. Use when the user asks Pi to create or alter Git history or refs, publish changes, resolve a merge or rebase, prepare commits, or carry out a Git workflow. Do not use merely for read-only status, diff, log, blame, or show inspection during another task.
---

# Manage Git

1. Confirm the requested outcome and inspect the repository root, status, current branch, `HEAD`, upstream, relevant diff, remotes, and applicable instructions before mutating Git state. Treat this snapshot as the baseline for post-operation verification.
2. Separate user changes by logical concern. Resolve the exact paths and refs in scope, distinguish staged, unstaged, and untracked changes, and never stage, commit, discard, reformat, or rewrite unrelated work.
3. Explain and obtain approval before destructive or difficult-to-recover operations, including history rewrites, forced updates, cleaning files, or discarding changes. Never run `git reset --hard` or `git clean` without explicit approval for that exact action.
4. Only commit, push, merge, rebase, create or delete branches or tags, or open pull requests when explicitly requested. Never create a commit as a side effect of another action. Prefer non-interactive commands, path-limited staging or commits when unrelated changes exist, and avoid force-push; if explicitly approved, use the safest applicable lease protection.
5. Before committing, inspect the exact staged diff and run checks proportionate to the staged change, including `git diff --check` when applicable. Confirm that sensitive-looking and generated paths are intentionally included, and do not overwrite changes from another session or user. Keep each commit to one logical concern and follow repository commit conventions. Commits made by the Agent must disable signing for that invocation with `-c commit.gpgSign=false` and `--no-gpg-sign`; do not change the user's persistent Git signing configuration. Add a `Co-authored-by` trailer only when the user, repository convention, or approved workflow calls for Pi attribution; do not add one merely because Pi executed the Git command.
6. Adversarially verify the operation before and after execution: check that the resolved commit, branch, upstream, remote, and included paths are exactly the intended targets; inspect for omitted, unrelated, generated, or sensitive files; and confirm the expected working-tree state. Do not report success from the command exit code alone.
7. Report the resulting refs or commits, commands and checks that materially establish success, anything intentionally left uncommitted or unpublished, and recovery guidance when relevant.

Read-only Git commands are evidence-gathering tools and may be used without this workflow. Git hosting actions remain externally visible even when the underlying Git command is reversible.
