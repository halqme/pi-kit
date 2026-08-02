# threads

Persistent Pi sessions exposed as a `threads` tool. A created thread is a normal Pi session and can be opened by a human with `/resume`.

Actions: `create`, `send_message`, `wait`, and `read`. Thread processes are kept by the current extension process; concurrent human and agent use is intentionally not coordinated.
