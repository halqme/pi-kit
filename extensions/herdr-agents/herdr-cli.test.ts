import assert from "node:assert/strict";
import test from "node:test";
import { HerdrCli, isServerNotRunning, type HerdrCommandResult } from "./herdr-cli.ts";

test("recognizes Herdr's server_not_running response", () => {
  assert.equal(
    isServerNotRunning({
      exitCode: 1,
      stdout: "",
      stderr: '{"error":{"code":"server_not_running","message":"not running"}}',
    }),
    true,
  );
});

test("starts a headless server and retries the command", async () => {
  const results: HerdrCommandResult[] = [
    {
      exitCode: 1,
      stdout: "",
      stderr: '{"error":{"code":"server_not_running","message":"not running"}}',
    },
    { exitCode: 0, stdout: '{"result":{"agents":[]}}', stderr: "" },
    { exitCode: 0, stdout: '{"result":{"agents":[]}}', stderr: "" },
  ];
  let starts = 0;
  const cli = new HerdrCli(
    "herdr",
    async () => results.shift() ?? { exitCode: 1, stdout: "", stderr: "missing" },
    async () => {
      starts += 1;
    },
  );

  const response = await cli.json(["agent", "list"]);

  assert.equal(starts, 1);
  assert.deepEqual(response.result?.agents, []);
});
