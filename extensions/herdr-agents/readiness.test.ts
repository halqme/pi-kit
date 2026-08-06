import assert from "node:assert/strict";
import test from "node:test";
import { HerdrCli, type HerdrCommandResult } from "./herdr-cli.ts";

test("retries agent start while a newly created pane is not yet a shell", async () => {
  let starts = 0;
  const run = async (_executable: string, args: string[]): Promise<HerdrCommandResult> => {
    if (args[0] === "--version") return { exitCode: 0, stdout: "herdr 0.8.0", stderr: "" };
    starts++;
    return starts < 3
      ? {
          exitCode: 1,
          stdout: "",
          stderr: '{"error":{"code":"agent_pane_busy","message":"pane busy"}}',
        }
      : { exitCode: 0, stdout: '{"result":{}}', stderr: "" };
  };
  const cli = new HerdrCli("herdr", run, async () => {});
  await cli.json(["agent", "start", "worker", "--kind", "pi", "--pane", "w1:p1"]);
  assert.equal(starts, 3);
});
