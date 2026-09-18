import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createOpenRouterSemanticEvaluator,
  parseSemanticDecisionResponse,
} from "./index.ts";

describe("parseSemanticDecisionResponse", () => {
  test("parses a Noul without inventing a confidence field", () => {
    const result = parseSemanticDecisionResponse(
      {
        model: "typesafe/jev-1.13",
        answers: {
          scope_drift: {
            type: "noul",
            noul: 0.82,
          },
        },
      },
      {
        scope_drift: {
          type: "noul",
          instructions: "Has the work moved outside the requested scope?",
        },
      },
    );

    assert.deepEqual(result.answers.scope_drift, {
      type: "noul",
      noul: 0.82,
    });
  });

  test("parses Choice distributions and confidence", () => {
    const result = parseSemanticDecisionResponse(
      {
        answers: {
          route: {
            type: "choice",
            choice: "review",
            probabilities: {
              continue: 0.25,
              review: 0.75,
            },
            confidence: 0.5,
          },
        },
      },
      {
        route: {
          type: "choice",
          instructions: "Which route fits the state?",
          criteria: {
            continue: "Continue normally.",
            review: "Request review.",
          },
        },
      },
    );

    assert.equal(result.answers.route.choice, "review");
    assert.equal(result.answers.route.probabilities.review, 0.75);
  });

  test("rejects out-of-range Noul probabilities", () => {
    assert.throws(
      () =>
        parseSemanticDecisionResponse(
          {
            answers: {
              gap: {
                type: "noul",
                noul: 1.2,
              },
            },
          },
          {
            gap: {
              type: "noul",
              instructions: "Is there a verification gap?",
            },
          },
        ),
      /between 0 and 1/,
    );
  });
});

describe("createOpenRouterSemanticEvaluator", () => {
  test("uses the Decisions API with state and typed questions directly", async () => {
    let requestUrl = "";
    let requestBody: unknown;

    const evaluate = createOpenRouterSemanticEvaluator({
      apiKey: "test-key",
      fetch: async (input, init) => {
        requestUrl = String(input);
        requestBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            model: "typesafe/jev-1.13",
            answers: {
              scope_drift: {
                type: "noul",
                noul: 0.2,
              },
            },
            usage: {
              input_tokens: 42,
              output_tokens: 3,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    const state = {
      request: "Only update the parser.",
      changes: "Changed parser.ts.",
    };

    const questions = {
      scope_drift: {
        type: "noul" as const,
        instructions: "Given `request` and `changes`, has the work moved outside the request?",
      },
    };

    const result = await evaluate({ state, questions });

    assert.equal(requestUrl, "https://openrouter.ai/api/alpha/decisions");
    assert.deepEqual(requestBody, {
      model: "typesafe/jev-1.13",
      state,
      questions,
    });
    assert.equal(result.answers.scope_drift.noul, 0.2);
  });
});
