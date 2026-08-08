# Runner

Runner executes an approved plan using Pi Kit's **Supervised Protocol Model** rather than encoding task progress as a finite-state machine.

The approved TODO, tool guidelines, session trace, and current runtime observations form a protocol that the agent interprets. Calls such as `start`, `progress`, `finish`, and `stop` are proposals. Supervisors inspect each proposal and may allow it, block it, or inject context that asks the agent to re-evaluate its next action.

```text
Protocol + session trace + observation
                 |
                 v
               Agent
                 |
              proposal
                 |
                 v
           supervisor(s)
          /      |       \
       allow    block    inject
         |        |        |
         v        |        +--> agent re-evaluates
      execute     +-----------> reject proposal
```

TODO completion is therefore evidence, not a completion transition. `runner.progress` records completed steps while the runner stays active. Once all steps are reported, the continuation context changes to verification; the agent must call `runner.finish` with concise evidence. A future model-backed reviewer can be added as another async supervisor without changing the runner protocol or turning it into a workflow engine.

Hard runtime facts remain explicit state. The shared `loop` controller owns bounded continuation, owner arbitration, and exhaustion. Loop exhaustion objectively stops a running plan; these lifecycle facts should not be inferred by the agent.

The separation is intentional:

```text
objective runtime lifecycle  -> explicit state
agent task judgment          -> supervised protocol
```
