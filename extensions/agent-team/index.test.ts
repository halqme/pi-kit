import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import agentTeamExtension from "./index.ts";

test("agent-team propagates invalid start input as an execute error", async () => {
  let tool: any;
  agentTeamExtension({
    on() {},
    registerTool(value: unknown) {
      tool = value;
    },
  } as unknown as ExtensionAPI);

  await assert.rejects(
    () =>
      tool.execute(
        "test-call",
        { action: "start", topic: "   ", members: [] },
        undefined,
        undefined,
        { ui: { setStatus() {} } },
      ),
    /topic is required for start/,
  );
});
