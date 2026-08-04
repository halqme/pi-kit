import assert from "node:assert/strict";
import test from "node:test";
import {
  HerdrCli,
  isServerNotRunning,
  isSupportedHerdrVersion,
  parseHerdrVersion,
  type HerdrCommandResult,
} from "./herdr-cli.ts";

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

test("parses and validates Herdr versions", () => {
  assert.equal(parseHerdrVersion("herdr 0.8.0"), "0.8.0");
  assert.equal(parseHerdrVersion("herdr 0.9.1-beta.2"), "0.9.1");
  assert.equal(isSupportedHerdrVersion("0.8.0"), true);
  assert.equal(isSupportedHerdrVersion("0.7.9"), false);
});

test("rejects an unsupported Herdr version before issuing API commands", async () => {
  const calls: string[][] = [];
  const cli = new HerdrCli("herdr", async (_executable, args) => {
    calls.push(args);
    return { exitCode: 0, stdout: "herdr 0.7.5\n", stderr: "" };
  });

  await assert.rejects(cli.json(["agent", "list"]), /0\.8\.0 or later/);
  assert.deepEqual(calls, [["--version"]]);
});

test("checks the version once, starts a headless server, and retries the command", async () => {
  const results: HerdrCommandResult[] = [
    { exitCode: 0, stdout: "herdr 0.8.0\n", stderr: "" },
    {
      exitCode: 1,
      stdout: "",
      stderr: '{"error":{"code":"server_not_running","message":"not running"}}',
    },
    { exitCode: 0, stdout: '{"result":{"agents":[]}}', stderr: "" },
    { exitCode: 0, stdout: '{"result":{"agents":[]}}', stderr: "" },
    { exitCode: 0, stdout: '{"result":{"agents":[]}}', stderr: "" },
  ];
  const calls: string[][] = [];
  let starts = 0;
  const cli = new HerdrCli(
    "herdr",
    async (_executable, args) => {
      calls.push(args);
      return results.shift() ?? { exitCode: 1, stdout: "", stderr: "missing" };
    },
    async () => {
      starts += 1;
    },
  );

  const first = await cli.json(["agent", "list"]);
  const second = await cli.json(["agent", "list"]);

  assert.equal(starts, 1);
  assert.deepEqual(first.result?.agents, []);
  assert.deepEqual(second.result?.agents, []);
  assert.equal(calls.filter((args) => args[0] === "--version").length, 1);
});
