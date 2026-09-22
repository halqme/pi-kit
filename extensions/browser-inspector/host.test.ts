import test from "node:test";
import assert from "node:assert/strict";
import { BrowserRuntime } from "./host.ts";

interface CdpCall {
  method: string;
  params?: Record<string, unknown>;
}

class FakeWebView {
  static readonly instances: FakeWebView[] = [];
  static closeAll(): void {}

  url = "about:blank";
  title = "Demo";
  onNavigated?: () => void;
  readonly calls: CdpCall[] = [];
  maxConcurrentCdp = 0;
  private activeCdp = 0;
  private documentRetrieved = false;

  constructor(_options: unknown) {
    FakeWebView.instances.push(this);
  }

  addEventListener(_type: string, _listener: (...args: unknown[]) => void): void {}

  close(): void {}

  async navigate(url: string): Promise<void> {
    this.url = url;
    this.onNavigated?.();
  }

  async cdp(method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method, ...(params ? { params } : {}) });
    this.activeCdp += 1;
    this.maxConcurrentCdp = Math.max(this.maxConcurrentCdp, this.activeCdp);
    if (this.activeCdp > 1) {
      this.activeCdp -= 1;
      throw new Error("concurrent CDP request");
    }

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      switch (method) {
        case "DOM.enable":
        case "CSS.enable":
        case "Network.enable":
        case "Runtime.enable":
        case "Page.enable":
        case "Runtime.releaseObject":
          return {};
        case "DOM.getDocument":
          this.documentRetrieved = true;
          return { root: { nodeId: 100 } };
        case "DOM.querySelectorAll":
          return { nodeIds: [1, 2] };
        case "DOM.describeNode": {
          const nodeId = Number(params?.nodeId);
          return {
            node: {
              nodeName: "BUTTON",
              localName: "button",
              attributes: ["id", `item-${nodeId}`],
            },
          };
        }
        case "DOM.resolveNode":
          return { object: { objectId: `object-${String(params?.nodeId)}` } };
        case "Runtime.callFunctionOn":
          return {
            result: {
              value: {
                text: `Node ${String(params?.objectId)}`,
                visible: true,
                focused: false,
                enabled: true,
                box: { x: 0, y: 0, width: 100, height: 30 },
              },
            },
          };
        case "Accessibility.getFullAXTree":
          return {
            nodes: [
              {
                nodeId: "root",
                ignored: false,
                role: { value: "RootWebArea" },
                name: { value: "Demo" },
              },
              {
                nodeId: "save",
                parentId: "root",
                ignored: false,
                role: { value: "button" },
                name: { value: "Save" },
                backendDOMNodeId: 11,
              },
              {
                nodeId: "docs",
                parentId: "root",
                ignored: false,
                role: { value: "link" },
                name: { value: "Docs" },
                backendDOMNodeId: 12,
              },
            ],
          };
        case "DOM.pushNodesByBackendIdsToFrontend": {
          if (!this.documentRetrieved) {
            throw new Error("Document needs to be requested first");
          }
          const backendNodeIds = params?.backendNodeIds;
          if (!Array.isArray(backendNodeIds)) throw new Error("backendNodeIds are required");
          return { nodeIds: backendNodeIds.map((id) => Number(id) + 1000) };
        }
        default:
          throw new Error(`Unexpected CDP method: ${method}`);
      }
    } finally {
      this.activeCdp -= 1;
    }
  }
}

const globalObject = globalThis as typeof globalThis & { Bun?: unknown };
const previousBun = globalObject.Bun;
globalObject.Bun = { WebView: FakeWebView } as unknown as typeof Bun;

test.beforeEach(() => {
  FakeWebView.instances.length = 0;
});

test.after(() => {
  if (previousBun === undefined) delete globalObject.Bun;
  else globalObject.Bun = previousBun;
});

test("inspect serializes CDP operations for multiple matched elements", async () => {
  const runtime = new BrowserRuntime();
  try {
    await runtime.dispatch({ action: "open", url: "https://example.test" });
    const view = FakeWebView.instances.at(-1);
    if (!view) throw new Error("fake view was not created");

    const result = (await runtime.dispatch({
      action: "inspect",
      target: { selector: ".item" },
    })) as { matches: Array<{ ref: string }>; total: number };

    assert.equal(view.maxConcurrentCdp, 1);
    assert.equal(result.total, 2);
    assert.deepEqual(
      result.matches.map((match) => match.ref),
      ["e1", "e2"],
    );
  } finally {
    runtime.close();
  }
});

test("snapshot retrieves the DOM document before creating element refs", async () => {
  const runtime = new BrowserRuntime();
  try {
    await runtime.dispatch({ action: "open", url: "https://example.test" });
    const view = FakeWebView.instances.at(-1);
    if (!view) throw new Error("fake view was not created");

    const result = (await runtime.dispatch({
      action: "snapshot",
      maxNodes: 10,
    })) as { text: string; shown: number; total: number; truncated: boolean };

    const methods = view.calls.map((call) => call.method);
    const documentIndex = methods.indexOf("DOM.getDocument");
    const pushIndex = methods.indexOf("DOM.pushNodesByBackendIdsToFrontend");
    assert.ok(documentIndex >= 0);
    assert.ok(pushIndex > documentIndex);
    assert.equal(result.text, 'RootWebArea "Demo"\n  e1 button "Save"\n  e2 link "Docs"');
    assert.deepEqual(
      { shown: result.shown, total: result.total, truncated: result.truncated },
      { shown: 3, total: 3, truncated: false },
    );
  } finally {
    runtime.close();
  }
});
