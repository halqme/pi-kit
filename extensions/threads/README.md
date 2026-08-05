# threads

Persistent Pi sessions exposed as a `threads` tool. A created thread is stored in Pi's normal session directory, so it appears in `/resume`. The tool also returns `resumeCommand` (`pi --session <path>`) for directly opening the exact session.

Actions: `create`, `send_message`, `wait`, and `read`. Thread processes are kept by the current extension process; concurrent human and agent use is intentionally not coordinated.
