import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HerdrCli, MIN_HERDR_VERSION, type HerdrResponse } from "./herdr-cli.ts";

const enabled = process.env.HERDR_INTEGRATION === "1";

test(
  "real Herdr starts and observes an interactive Pi agent",
  { skip: !enabled, timeout: 120_000 },
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), "herdr-agents-integration-"));
    const cli = new HerdrCli();
    const name = `it-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    let workspaceId: string | undefined;

    try {
      const version = await cli.version();
      assert.match(version, /^\d+\.\d+\.\d+$/);

      const created = resultOf(
        await cli.json([
          "workspace",
          "create",
          "--cwd",
          cwd,
          "--label",
          `pi-kit-integration:${name}`,
          "--no-focus",
        ]),
      );
      const workspace = recordOf(created.workspace, "workspace");
      const pane = recordOf(created.root_pane, "root_pane");
      workspaceId = stringOf(workspace.workspace_id ?? workspace.id, "workspace id");
      const paneId = stringOf(pane.pane_id ?? pane.id, "pane id");

      await cli.json([
        "agent",
        "start",
        name,
        "--kind",
        "pi",
        "--pane",
        paneId,
        "--timeout",
        "30000",
        "--",
        "--no-extensions",
      ]);
      const fetched = resultOf(await cli.json(["agent", "get", name]));
      const agent = recordOf(fetched.agent, "agent");
      assert.equal(stringOf(agent.name ?? agent.pane_id, "agent name"), name);
    } finally {
      try {
        await cli.json(["agent", "send-keys", name, "ctrl+c"]);
      } catch {
        // The agent may already have exited; workspace cleanup remains authoritative.
      }
      if (workspaceId) {
        try {
          await cli.json(["workspace", "close", workspaceId]);
        } catch {
          // Preserve the primary assertion failure.
        }
      }
      await rm(cwd, { recursive: true, force: true });
    }
  },
);

test("documents the integration-test compatibility floor", () => {
  assert.equal(MIN_HERDR_VERSION, "0.8.0");
});

function resultOf(response: HerdrResponse): Record<string, unknown> {
  return recordOf(response.result, "result");
}

function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Herdr response did not include ${label}`);
  }
  return value as Record<string, unknown>;
}

function stringOf(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Missing ${label}`);
  return value;
}
