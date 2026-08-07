import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import loopExtension from "./index.ts";

test("loop registers a bounded repeat tool", async () => {
  let tool: any;
  let end: any;
  const sent: string[] = [];
  const pi = {
    registerTool(value: any) {
      tool = value;
    },
    on(name: string, handler: any) {
      if (name === "agent_end") end = handler;
    },
    sendUserMessage(message: string) {
      sent.push(message);
    },
  } as unknown as ExtensionAPI;
  loopExtension(pi);
  const ctx = { isIdle: () => true } as any;
  await tool.execute(
    "id",
    { action: "start", message: "continue", iterations: 2 },
    undefined,
    undefined,
    ctx,
  );
  assert.equal(sent.length, 1);
  await end({}, ctx);
  assert.equal(sent.length, 2);
  await end({}, ctx);
  assert.equal(sent.length, 2);
});
