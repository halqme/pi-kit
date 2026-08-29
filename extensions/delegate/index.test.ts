import assert from "node:assert/strict";
import test from "node:test";
import extension from "./index.ts";

test("registers one isolated delegation tool", () => {
  const tools: any[] = [];
  extension({
    registerTool(tool: unknown) {
      tools.push(tool);
    },
  } as any);
  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.name, "delegate");
  const schema = tools[0]?.parameters;
  const variants = schema.anyOf ?? schema.oneOf ?? [];
  const actions = variants
    .map((variant: any) => variant.properties?.action?.const)
    .filter((value: unknown) => typeof value === "string");
  assert.deepEqual(new Set(actions), new Set(["start", "status", "stop", "cleanup"]));
});
