import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiRpc } from "./rpc.ts";

test("PiRpc sends commands and correlates responses", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-threads-test-"));
  const rpc = new PiRpc(join(dir, "session.jsonl"), dir);
  try {
    const response = await rpc.command("get_state");
    assert.equal(response.type, "response");
    assert.equal(response.command, "get_state");
    assert.equal(response.success, true);
  } finally {
    await rpc.stop();
  }
});

test("PiRpc wait times out", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-threads-test-"));
  const rpc = new PiRpc(join(dir, "session.jsonl"), dir);
  try {
    await assert.rejects(rpc.wait(10), /timed out/);
  } finally {
    await rpc.stop();
  }
});
