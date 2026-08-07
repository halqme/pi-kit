# threads

Persistent Pi sessions exposed as a `threads` tool. Threads use Pi's normal session IDs and session directory, so a thread appears in `/resume` after its first completed assistant response. The tool also returns `resumeCommand` (`pi --session <path>`) for directly opening the exact session.

Actions: `create`, `list`, `send_message`, and `read`. `send_message` returns immediately; use `read` to inspect the resulting conversation. `list` reads markers stored in the parent Pi session and therefore returns only sessions spawned by this extension, together with their parent session path. Humans can run `/threads` to view the same parent-scoped list. Thread processes are kept by the current extension process; concurrent human and agent use is intentionally not coordinated.

Each thread has independent Pi conversation/session state, but filesystem state is not isolated automatically. Unless `cwd` is explicitly changed, child threads operate in the same working directory as the parent. If multiple threads may write overlapping files or Git state, the coordinator must choose an appropriate strategy such as disjoint work, worktrees, or sequential execution.
