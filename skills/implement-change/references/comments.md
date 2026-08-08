# Comments and documentation

Treat implementation comments and documentation comments as different interfaces. Do not apply one rule to both.

## Implementation comments: bind code to external constraints

An implementation comment should primarily preserve information that cannot be recovered from the commented code itself. Use it to bind a local implementation choice to an independently verifiable constraint outside that implementation: a protocol or specification, upstream behavior or bug, compatibility requirement, security or data invariant, product rule, measured operational fact, or similar evidence.

State the constraint and why it forces the local choice rather than narrating what the code does. When practical, identify a stable source or verification path. A future agent in a different session should be able to verify the comment without trusting the previous agent's explanation.

If the relevant fact can instead be enforced mechanically by a type, test, assertion, schema, linter, protocol supervisor, or other executable check, prefer that enforcement and keep a comment only when the external reason still needs to be preserved. Remove or update the comment when its constraint no longer applies.

Avoid comments that merely translate nearby code into natural language. Prefer clearer names, structure, types, or extracted operations when the implementation itself can carry the meaning.

## Documentation comments: describe the API for humans and tools

Documentation comments such as JSDoc, rustdoc, Swift documentation comments, and Haddock are part of the API surface consumed through editor hovers, generated documentation, symbol browsers, and similar tooling. They may describe behavior that is also visible in the implementation because their intended reader often does not read the implementation at all.

Document the observable contract needed to use the symbol correctly: purpose, inputs and outputs, errors, preconditions and postconditions, invariants, lifecycle expectations, and usage where useful. Do not require an external constraint merely to justify documentation. Avoid implementation detail unless it affects correct use of the API.
