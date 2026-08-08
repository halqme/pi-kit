# Protocol Supervision

`@halqme/protocol-supervision` provides the minimal primitives for Pi Kit's **Supervised Protocol Model**.

A Pi agent already interprets procedural guidance from `AGENTS.md`, skills, tool descriptions, and the conversation trace. The runtime should not duplicate that protocol as a finite-state machine unless the world itself has an objective lifecycle state.

Instead, execution is modeled as:

```text
Protocol + Trace + Observation
             |
             v
           Agent
             |
          Proposal
             |
             v
        Supervisor(s)
        /     |      \
     allow   block   inject
       |       |       |
       v       |       +--> Agent re-evaluates with added context
    execute    +----------> Proposal is rejected
```

A supervisor may be deterministic code or an async semantic reviewer backed by another model. Both use the same interface and return a decision; the package does not own workflow state, retries, persistence, tools, or model calls.

Use explicit state machines for runtime facts such as process liveness, resource ownership, and loop exhaustion. Use protocol supervision when the next action depends on the agent's interpretation of the task and its execution trace.
