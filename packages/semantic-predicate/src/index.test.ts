import { describe, expect, test } from "bun:test";
import { parseSemanticDecisions } from "./index.ts";

describe("parseSemanticDecisions", () => {
  test("accepts complete bounded decisions", () => {
    const result = parseSemanticDecisions(
      {
        results: {
          scopeDrift: {
            value: true,
            probability: 0.82,
            confidence: 0.91,
          },
        },
      },
      {
        scopeDrift: {
          description: "Has the work moved outside the requested scope?",
        },
      },
    );

    expect(result.scopeDrift).toEqual({
      value: true,
      probability: 0.82,
      confidence: 0.91,
    });
  });

  test("rejects missing predicates", () => {
    expect(() =>
      parseSemanticDecisions(
        { results: {} },
        {
          missingEvidence: {
            description: "Is completion evidence missing?",
          },
        },
      ),
    ).toThrow("missing predicate");
  });

  test("rejects probabilities outside the unit interval", () => {
    expect(() =>
      parseSemanticDecisions(
        {
          results: {
            consistencyRisk: {
              value: false,
              probability: 1.2,
              confidence: 0.5,
            },
          },
        },
        {
          consistencyRisk: {
            description: "Are the changes likely inconsistent with the repository?",
          },
        },
      ),
    ).toThrow("between 0 and 1");
  });
});
