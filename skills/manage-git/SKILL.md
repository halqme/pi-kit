---
name: manage-git
description: Perform explicit Git repository operations involving commits, branches, merges, rebases, tags, remotes, pushes, or pull-request preparation. Use when the user asks Pi to create or alter Git history or refs, publish changes, resolve a merge or rebase, prepare commits, or carry out a Git workflow. Do not use merely for read-only status, diff, log, blame, or show inspection during another task.
---

# Manage Git

1. Confirm the requested outcome and inspect repository root, status, current branch, relevant diff, remotes, and applicable instructions before mutating Git state.
2. Separate user changes by logical concern. Never stage, commit, discard, reformat, or rewrite unrelated work.
3. Explain and obtain approval before destructive or difficult-to-recover operations, including history rewrites, forced updates, cleaning files, or discarding changes. Never run `git reset --hard` or `git clean` without explicit approval for that exact action.
4. Only commit, push, merge, rebase, create or delete branches or tags, or open pull requests when explicitly requested. Prefer non-interactive commands and avoid force-push; if explicitly approved, use the safest applicable lease protection.
5. Before committing, inspect the staged diff and run checks proportionate to the staged change. Keep each commit to one logical concern and follow repository commit conventions. Add `Co-authored-by: Pi-Coding-Agent` for commits authored by Pi unless local instructions specify otherwise.
6. Adversarially verify the operation before and after execution: check that the resolved commit, branch, upstream, remote, and included paths are exactly the intended targets; inspect for omitted, unrelated, generated, or sensitive files.
7. Report the resulting refs or commits, commands and checks that materially establish success, anything intentionally left uncommitted or unpublished, and recovery guidance when relevant.

Read-only Git commands are evidence-gathering tools and may be used without this workflow. Git hosting actions remain externally visible even when the underlying Git command is reversible.
