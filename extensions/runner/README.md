# Runner

Runner executes an approved plan while `loop` provides bounded self-continuation between agent turns.

The plan state is authoritative. Runner lifecycle changes go through `transitionRunner` in `@halqme/plan-state` instead of mutating `PlanState.status` directly.

```text
approved --start--> running --progress(all steps)--> completed
                        |
                        +--stop---------------------> stopped
                        |
                        +--loop exhaustion----------> stopped
```

`loop.maxTurns` is an external runaway fuse, not a completion condition. A runner-owned loop ends normally only when the runner state reaches `completed`, and loop exhaustion maps to a stopped runner state with the fuse reason preserved.

Keeping continuation and execution state separate lets the runner state machine grow additional admission or verification states without teaching the generic loop controller about plan semantics.
