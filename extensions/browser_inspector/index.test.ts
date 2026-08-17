import test from "node:test";
import assert from "node:assert/strict";
import extension, { setBrowserHostFactoryForTests } from "./index.ts";
import type { BrowserCommand, BrowserHost } from "./protocol.ts";

test("browser_inspector registers a snake_case tool and forwards commands to one host", async () => {
  const commands: BrowserCommand[] = [];
  let disposed = 0;
  const fake: BrowserHost = {
    async request(command) {
      commands.push(command);
      if (command.action === "screenshot") return { path: command.outputPath };
      return { action: command.action };
    },
    async dispose() {
      disposed += 1;
    },
  };
  setBrowserHostFactoryForTests(() => fake);

  let tool: any;
  const events = new Map<string, (...args: any[]) => unknown>();
  const pi: any = {
    registerTool(value: any) {
      tool = value;
    },
    on(name: string, handler: (...args: any[]) => unknown) {
      events.set(name, handler);
    },
  };
  extension(pi);

  assert.equal(tool.name, "browser_inspector");
  const ctx = { cwd: "/tmp/project" };
  await tool.execute(
    "open-1",
    { action: "open", url: "http://localhost:8787", viewport: { width: 1280, height: 720 } },
    undefined,
    undefined,
    ctx,
  );
  await tool.execute(
    "styles-1",
    { action: "styles", target: { selector: ".composer" }, properties: ["padding-left"] },
    undefined,
    undefined,
    ctx,
  );
  const screenshot = await tool.execute(
    "shot-1",
    { action: "screenshot", target: { ref: "e1" } },
    undefined,
    undefined,
    ctx,
  );

  assert.deepEqual(commands[0], {
    action: "open",
    url: "http://localhost:8787",
    viewport: { width: 1280, height: 720 },
  });
  assert.deepEqual(commands[1], {
    action: "styles",
    target: { selector: ".composer" },
    properties: ["padding-left"],
  });
  assert.equal(commands[2]?.action, "screenshot");
  assert.match(
    (commands[2] as Extract<BrowserCommand, { action: "screenshot" }>).outputPath,
    /pi-kit-browser-inspector/,
  );
  assert.match(screenshot.content[0].text, /^Screenshot: /);

  await events.get("session_shutdown")?.({}, ctx);
  assert.equal(disposed, 1);
  setBrowserHostFactoryForTests();
});

test("browser_inspector validates action-specific required fields before starting the host", async () => {
  let starts = 0;
  setBrowserHostFactoryForTests(() => {
    starts += 1;
    return {
      async request() {
        return {};
      },
      async dispose() {},
    };
  });
  let tool: any;
  const pi: any = {
    registerTool(value: any) {
      tool = value;
    },
    on() {},
  };
  extension(pi);
  await assert.rejects(() =>
    tool.execute("bad", { action: "open" }, undefined, undefined, { cwd: "/tmp" }),
  );
  await assert.rejects(
    () => tool.execute("bad-inspect", { action: "inspect" }, undefined, undefined, { cwd: "/tmp" }),
    /target is required for inspect\. Pass target as/,
  );
  assert.equal(starts, 0);
  setBrowserHostFactoryForTests();
});
