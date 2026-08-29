import assert from "node:assert/strict";
import test from "node:test";
import extension from "./index.ts";

test("exposes repository capabilities only as context and code", async () => {
  const tools: Array<{ name: string }> = [];
  const shutdown: Array<() => Promise<void> | void> = [];
  extension({
    registerTool(tool: { name: string }) {
      tools.push(tool);
    },
    on(event: string, handler: () => Promise<void> | void) {
      if (event === "session_shutdown") shutdown.push(handler);
    },
  } as never);

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["context", "code"],
  );
  assert.equal(
    tools.some((tool) => tool.name === "astrolabe"),
    false,
  );
  assert.equal(
    tools.some((tool) => tool.name === "bm25_search"),
    false,
  );

  for (const handler of shutdown) await handler();
});
