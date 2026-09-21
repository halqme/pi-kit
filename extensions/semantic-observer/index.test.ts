import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Provider } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import semanticObserverExtension from "./index.ts";

async function createRuntime(
  auth: object,
): Promise<{ runtime: ModelRuntime; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "pi-semantic-observer-"));
  await writeFile(join(root, "auth.json"), JSON.stringify(auth));

  const runtime = await ModelRuntime.create({
    authPath: join(root, "auth.json"),
    modelsPath: null,
    allowModelNetwork: false,
  });
  let provider: Provider | undefined;
  semanticObserverExtension({
    registerProvider(candidate: Provider) {
      provider = candidate;
    },
    registerTool() {},
  } as any);
  assert.ok(provider);
  runtime.registerNativeProvider(provider);
  return {
    runtime,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("resolves the TypeSafe key from auth.json without an environment fallback", async (t) => {
  const previous = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "environment-key";
  t.after(() => {
    if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previous;
  });

  const { runtime, cleanup } = await createRuntime({
    typesafe: { type: "api_key", key: "stored-key" },
  });
  t.after(cleanup);

  assert.equal((await runtime.getAuth("typesafe"))?.auth.apiKey, "stored-key");
});

test("does not resolve TypeSafe auth from TYPESAFE_API_KEY alone", async (t) => {
  const previous = process.env.TYPESAFE_API_KEY;
  process.env.TYPESAFE_API_KEY = "environment-key";
  t.after(() => {
    if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previous;
  });

  const { runtime, cleanup } = await createRuntime({});
  t.after(cleanup);

  assert.equal(await runtime.getAuth("typesafe"), undefined);
});
