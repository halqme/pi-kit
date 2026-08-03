import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderFooter } from "./render.ts";

test("keeps extension status messages in the footer", () => {
  const lines = renderFooter(
    [{ text: "model: terra" }],
    new Map([
      ["background-process", "1 running"],
      ["agent-team", "1 awaiting user"],
    ]),
    80,
  );

  assert.match(lines.join("\n"), /background-process: 1 running/);
  assert.match(lines.join("\n"), /agent-team: 1 awaiting user/);
});

test("wraps complete segments before truncating", () => {
  const lines = renderFooter(
    [{ text: "model: terra" }, { text: "ctx 12.0%/128k" }],
    new Map([["background-process", "1 running"]]),
    24,
  );

  assert.equal(lines.length, 3);
  assert.equal(lines[0], "model: terra");
  assert.equal(lines[1], "ctx 12.0%/128k");
  assert.match(lines[2] ?? "", /^background-process: 1/);
  assert.ok(lines.every((line) => visibleWidth(line) <= 24));
});
