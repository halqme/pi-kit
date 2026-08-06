import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { THREAD_ENTRY_TYPE, createThreadSession, recordedThreads } from "./session-store.ts";

test("allocates a standard Pi session identity and records its parent", async () => {
  const sessionDir = await mkdtemp(join(tmpdir(), "threads-sessions-"));
  const cwd = process.cwd();
  const parent = SessionManager.create(cwd, sessionDir);
  const parentFile = parent.getSessionFile();
  assert.ok(parentFile);

  const spawned = createThreadSession(cwd, sessionDir, parentFile, "thread-1");
  assert.match(spawned.sessionFile, /\d{4}-\d{2}-\d{2}T.*_[0-9a-f-]{36}\.jsonl$/);
  assert.equal(spawned.parentSession, parentFile);
  assert.match(spawned.sessionFile, new RegExp(`${spawned.sessionId}\\.jsonl$`));
});

test("lists only thread markers stored in the parent Pi session", () => {
  const spawned = {
    id: "thread-1",
    sessionId: "session-1",
    sessionFile: "/tmp/session.jsonl",
    parentSession: "/tmp/parent.jsonl",
    cwd: "/tmp/project",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  assert.deepEqual(
    recordedThreads([
      { type: "custom", customType: "other", data: spawned },
      { type: "custom", customType: THREAD_ENTRY_TYPE, data: spawned },
    ]),
    [spawned],
  );
});
