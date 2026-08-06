import test from "node:test";

test("terminal extension module loads", async () => {
  await import("./index.ts");
});
