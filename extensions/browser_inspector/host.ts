import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import type {
  BrowserCommand,
  BrowserTarget,
  HostRequest,
  HostResponse,
  StylePreset,
} from "./protocol.ts";

interface ElementRef {
  nodeId: number;
  generation: number;
}

interface RemoteObject {
  objectId?: string;
  description?: string;
  value?: unknown;
  preview?: { properties?: Array<{ name?: string; value?: string }> };
}

interface ConsoleEntry {
  cursor: number;
  level: string;
  message: string;
  timestamp: number;
}

interface NetworkEntry {
  cursor: number;
  method: string;
  url: string;
  type?: string;
  status?: number;
  failed: boolean;
  error?: string;
}

const STYLE_PRESETS: Record<Exclude<StylePreset, "all">, string[]> = {
  layout: [
    "display",
    "position",
    "box-sizing",
    "width",
    "height",
    "min-width",
    "min-height",
    "max-width",
    "max-height",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "gap",
    "row-gap",
    "column-gap",
    "align-items",
    "align-content",
    "justify-items",
    "justify-content",
    "overflow",
    "overflow-x",
    "overflow-y",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-radius",
    "visibility",
    "opacity",
    "transform",
  ],
  typography: [
    "color",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "line-height",
    "letter-spacing",
    "text-align",
    "text-decoration-line",
    "white-space",
  ],
  paint: [
    "background-color",
    "background-image",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "box-shadow",
    "color",
    "opacity",
    "outline-color",
    "outline-style",
    "outline-width",
  ],
};

class BrowserRuntime {
  private view: Bun.WebView | undefined;
  private viewport = { width: 1440, height: 900 };
  private generation = 0;
  private nextRef = 1;
  private readonly refs = new Map<string, ElementRef>();
  private readonly nodeRefs = new Map<number, string>();
  private nextConsoleCursor = 1;
  private nextNetworkCursor = 1;
  private readonly consoleEntries: ConsoleEntry[] = [];
  private readonly networkEntries: NetworkEntry[] = [];
  private readonly requests = new Map<string, { method: string; url: string }>();
  private readonly styleSheets = new Map<string, string>();

  private resetDocument(): void {
    this.generation += 1;
    this.refs.clear();
    this.nodeRefs.clear();
  }

  private formatConsoleArg(value: unknown): string {
    if (value === null || value === undefined || typeof value !== "object") return String(value);
    const remote = value as RemoteObject;
    if (remote.description) return remote.description;
    const preview = remote.preview?.properties;
    if (preview?.length) {
      return `{ ${preview.map((item) => `${item.name ?? "?"}: ${item.value ?? "?"}`).join(", ")} }`;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private createView(viewport = this.viewport): Bun.WebView {
    this.viewport = viewport;
    const view = new Bun.WebView({
      width: viewport.width,
      height: viewport.height,
      backend: { type: "chrome", url: false } as Bun.WebView.Backend,
      dataStore: "ephemeral",
      console: (type, ...args) => {
        this.consoleEntries.push({
          cursor: this.nextConsoleCursor++,
          level: type,
          message: args.map((arg) => this.formatConsoleArg(arg)).join(" "),
          timestamp: Date.now(),
        });
      },
    });
    view.onNavigated = () => this.resetDocument();
    return view;
  }

  private async enableDomains(view: Bun.WebView): Promise<void> {
    await view.cdp("DOM.enable");
    await view.cdp("CSS.enable");
    await view.cdp("Network.enable");
    await view.cdp("Runtime.enable");
    await view.cdp("Page.enable");

    view.addEventListener("CSS.styleSheetAdded", (event) => {
      const data = (event as unknown as { data?: unknown }).data as
        | { header?: { styleSheetId?: string; sourceURL?: string } }
        | undefined;
      const id = data?.header?.styleSheetId;
      if (id) this.styleSheets.set(id, data?.header?.sourceURL ?? "");
    });
    view.addEventListener("Network.requestWillBeSent", (event) => {
      const data = (event as unknown as { data?: unknown }).data as
        | { requestId?: string; request?: { method?: string; url?: string } }
        | undefined;
      if (!data?.requestId || !data.request) return;
      this.requests.set(data.requestId, {
        method: data.request.method ?? "GET",
        url: data.request.url ?? "",
      });
    });
    view.addEventListener("Network.responseReceived", (event) => {
      const data = (event as unknown as { data?: unknown }).data as
        | {
            requestId?: string;
            type?: string;
            response?: { url?: string; status?: number };
          }
        | undefined;
      if (!data?.requestId || !data.response) return;
      const request = this.requests.get(data.requestId);
      this.networkEntries.push({
        cursor: this.nextNetworkCursor++,
        method: request?.method ?? "GET",
        url: data.response.url ?? request?.url ?? "",
        ...(data.type ? { type: data.type } : {}),
        ...(typeof data.response.status === "number" ? { status: data.response.status } : {}),
        failed: false,
      });
    });
    view.addEventListener("Network.loadingFailed", (event) => {
      const data = (event as unknown as { data?: unknown }).data as
        | { requestId?: string; type?: string; errorText?: string }
        | undefined;
      if (!data?.requestId) return;
      const request = this.requests.get(data.requestId);
      this.networkEntries.push({
        cursor: this.nextNetworkCursor++,
        method: request?.method ?? "GET",
        url: request?.url ?? "",
        ...(data.type ? { type: data.type } : {}),
        failed: true,
        ...(data.errorText ? { error: data.errorText } : {}),
      });
    });
  }

  private async newView(viewport = this.viewport): Promise<Bun.WebView> {
    this.view?.close();
    this.view = undefined;
    this.requests.clear();
    this.styleSheets.clear();
    this.resetDocument();
    const view = this.createView(viewport);
    this.view = view;
    await view.navigate("about:blank");
    await this.enableDomains(view);
    return view;
  }

  private requireView(): Bun.WebView {
    if (!this.view) throw new Error("No browser page is open. Use action=open first.");
    return this.view;
  }

  private async cdp<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    return (await this.requireView().cdp(method, params)) as T;
  }

  private refFor(nodeId: number): string {
    const existing = this.nodeRefs.get(nodeId);
    if (existing) return existing;
    const ref = `e${this.nextRef++}`;
    this.refs.set(ref, { nodeId, generation: this.generation });
    this.nodeRefs.set(nodeId, ref);
    return ref;
  }

  private async nodeForRef(ref: string): Promise<number> {
    const stored = this.refs.get(ref);
    if (!stored || stored.generation !== this.generation) {
      throw new Error(`stale_ref: ${ref} does not belong to the current document`);
    }
    try {
      await this.cdp("DOM.describeNode", { nodeId: stored.nodeId, depth: 0 });
    } catch {
      this.refs.delete(ref);
      this.nodeRefs.delete(stored.nodeId);
      throw new Error(`stale_ref: ${ref} no longer identifies a live DOM node`);
    }
    return stored.nodeId;
  }

  private async nodesForTarget(target: BrowserTarget): Promise<number[]> {
    if ("ref" in target) return [await this.nodeForRef(target.ref)];
    if ("point" in target) {
      const result = await this.cdp<{ nodeId?: number }>("DOM.getNodeForLocation", {
        x: target.point.x,
        y: target.point.y,
        includeUserAgentShadowDOM: true,
      });
      return result.nodeId ? [result.nodeId] : [];
    }
    const { root } = await this.cdp<{ root: { nodeId: number } }>("DOM.getDocument", {
      depth: 0,
      pierce: true,
    });
    const result = await this.cdp<{ nodeIds: number[] }>("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: target.selector,
    });
    return result.nodeIds;
  }

  private async singleNode(target: BrowserTarget): Promise<number> {
    const nodes = await this.nodesForTarget(target);
    if (nodes.length !== 1) {
      throw new Error(
        nodes.length === 0
          ? "Browser target matched no elements"
          : `Browser target matched ${nodes.length} elements; inspect first and use a returned ref`,
      );
    }
    return nodes[0]!;
  }

  private async callOnNode<T>(
    nodeId: number,
    functionDeclaration: string,
    args: unknown[] = [],
  ): Promise<T> {
    const resolved = await this.cdp<{ object: RemoteObject }>("DOM.resolveNode", { nodeId });
    const objectId = resolved.object.objectId;
    if (!objectId) throw new Error("Could not resolve DOM node to a runtime object");
    try {
      const result = await this.cdp<{ result: RemoteObject }>("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration,
        arguments: args.map((value) => ({ value })),
        returnByValue: true,
        awaitPromise: true,
      });
      return result.result.value as T;
    } finally {
      await this.cdp("Runtime.releaseObject", { objectId }).catch(() => undefined);
    }
  }

  private async inspectNode(nodeId: number): Promise<unknown> {
    const described = await this.cdp<{
      node: { nodeName: string; localName?: string; attributes?: string[] };
    }>("DOM.describeNode", { nodeId, depth: 0 });
    const attributes: Record<string, string> = {};
    const flat = described.node.attributes ?? [];
    for (let index = 0; index + 1 < flat.length; index += 2) {
      attributes[flat[index]!] = flat[index + 1]!;
    }
    const runtime = await this.callOnNode<{
      text: string;
      visible: boolean;
      focused: boolean;
      enabled: boolean;
      box: { x: number; y: number; width: number; height: number };
    }>(
      nodeId,
      `function () {
        const rect = this.getBoundingClientRect();
        const style = getComputedStyle(this);
        return {
          text: String(this.innerText ?? this.textContent ?? "").slice(0, 2000),
          visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
          focused: document.activeElement === this,
          enabled: !(this.matches && this.matches(":disabled")),
          box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      }`,
    );
    return {
      ref: this.refFor(nodeId),
      tag: (described.node.localName || described.node.nodeName).toLowerCase(),
      id: attributes.id ?? null,
      classes: (attributes.class ?? "").split(/\s+/).filter(Boolean),
      attributes,
      text: runtime.text,
      state: {
        visible: runtime.visible,
        focused: runtime.focused,
        enabled: runtime.enabled,
      },
      box: runtime.box,
    };
  }

  private styleSelection(
    properties: string[] | undefined,
    preset: StylePreset | undefined,
  ): Set<string> | undefined {
    if (properties?.length) return new Set(properties);
    const selected = preset ?? "layout";
    return selected === "all" ? undefined : new Set(STYLE_PRESETS[selected]);
  }

  private unresolvedVariables(value: string): string[] {
    return [...value.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)]
      .map((match) => match[1]!)
      .filter(Boolean);
  }

  private async styles(command: Extract<BrowserCommand, { action: "styles" }>): Promise<unknown> {
    const nodeId = await this.singleNode(command.target);
    const selection = this.styleSelection(command.properties, command.preset);
    const computedResult = await this.cdp<{
      computedStyle: Array<{ name: string; value: string }>;
    }>("CSS.getComputedStyleForNode", { nodeId });
    const computedAll = Object.fromEntries(
      computedResult.computedStyle.map((item) => [item.name, item.value]),
    );
    const computed = Object.fromEntries(
      computedResult.computedStyle
        .filter((item) => !selection || selection.has(item.name))
        .map((item) => [item.name, item.value]),
    );
    const matched = await this.cdp<{
      matchedCSSRules?: Array<{
        rule: {
          styleSheetId?: string;
          selectorList?: { text?: string };
          style: {
            cssProperties?: Array<{
              name?: string;
              value?: string;
              important?: boolean;
              disabled?: boolean;
              parsedOk?: boolean;
            }>;
          };
        };
      }>;
      inlineStyle?: {
        cssProperties?: Array<{
          name?: string;
          value?: string;
          important?: boolean;
          disabled?: boolean;
          parsedOk?: boolean;
        }>;
      };
    }>("CSS.getMatchedStylesForNode", { nodeId });

    const declarations: Array<Record<string, unknown>> = [];
    const referencedVariables = new Set<string>();
    const collect = (
      properties:
        | Array<{
            name?: string;
            value?: string;
            important?: boolean;
            disabled?: boolean;
            parsedOk?: boolean;
          }>
        | undefined,
      selector: string,
      source: string,
    ): void => {
      for (const property of properties ?? []) {
        const name = property.name ?? "";
        const value = property.value ?? "";
        const variables = this.unresolvedVariables(value);
        for (const variable of variables) referencedVariables.add(variable);
        if (selection && !selection.has(name) && variables.length === 0) continue;
        declarations.push({
          name,
          value,
          selector,
          source,
          important: property.important ?? false,
          disabled: property.disabled ?? false,
          parsedOk: property.parsedOk ?? true,
        });
      }
    };
    collect(matched.inlineStyle?.cssProperties, "<inline>", "");
    for (const entry of matched.matchedCSSRules ?? []) {
      collect(
        entry.rule.style.cssProperties,
        entry.rule.selectorList?.text ?? "<rule>",
        entry.rule.styleSheetId ? (this.styleSheets.get(entry.rule.styleSheetId) ?? "") : "",
      );
    }

    const variableNames = [...referencedVariables];
    const variableValues = variableNames.length
      ? await this.callOnNode<Record<string, string>>(
          nodeId,
          `function (names) {
            const style = getComputedStyle(this);
            return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]));
          }`,
          [variableNames],
        )
      : {};
    const variables = Object.fromEntries(
      variableNames.map((name) => [
        name,
        variableValues[name]
          ? { status: "resolved", value: variableValues[name] }
          : { status: "unset", value: "" },
      ]),
    );
    const diagnostics = variableNames
      .filter((name) => !variableValues[name])
      .map((name) => ({ kind: "unresolved-custom-property", variable: name }));

    return {
      computed,
      declarations,
      variables,
      diagnostics,
      ref: this.refFor(nodeId),
      computedCount: Object.keys(computedAll).length,
    };
  }

  private async pointForTarget(target: BrowserTarget): Promise<{ x: number; y: number }> {
    if ("point" in target) return target.point;
    const nodeId = await this.singleNode(target);
    await this.cdp("DOM.scrollIntoViewIfNeeded", { nodeId });
    const box = await this.callOnNode<{ x: number; y: number; width: number; height: number }>(
      nodeId,
      `function () {
        const rect = this.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }`,
    );
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  private async interact(
    command: Extract<BrowserCommand, { action: "interact" }>,
  ): Promise<unknown> {
    const view = this.requireView();
    switch (command.operation) {
      case "click": {
        if (!command.target) throw new Error("target is required for click");
        if ("selector" in command.target) await view.click(command.target.selector);
        else {
          const point = await this.pointForTarget(command.target);
          await view.click(point.x, point.y);
        }
        return { operation: "click" };
      }
      case "type": {
        if (!command.target) throw new Error("target is required for type");
        if (command.text === undefined) throw new Error("text is required for type");
        if ("selector" in command.target) await view.click(command.target.selector);
        else {
          const point = await this.pointForTarget(command.target);
          await view.click(point.x, point.y);
        }
        await view.type(command.text);
        return { operation: "type", length: command.text.length };
      }
      case "press":
        if (!command.key) throw new Error("key is required for press");
        await view.press(command.key);
        return { operation: "press", key: command.key };
      case "scroll":
        await view.scroll(command.dx ?? 0, command.dy ?? 0);
        return { operation: "scroll", dx: command.dx ?? 0, dy: command.dy ?? 0 };
      case "resize":
        if (!command.width || !command.height) {
          throw new Error("width and height are required for resize");
        }
        await view.resize(command.width, command.height);
        this.viewport = { width: command.width, height: command.height };
        return { operation: "resize", viewport: this.viewport };
      case "reload":
        await view.reload();
        return { operation: "reload", url: view.url, title: view.title };
      case "back":
        await view.back();
        return { operation: "back", url: view.url, title: view.title };
      case "forward":
        await view.forward();
        return { operation: "forward", url: view.url, title: view.title };
    }
  }

  async dispatch(command: BrowserCommand): Promise<unknown> {
    switch (command.action) {
      case "probe": {
        const temporary = this.view ? undefined : await this.newView();
        const browser = await this.cdp<{
          product?: string;
          protocolVersion?: string;
          userAgent?: string;
        }>("Browser.getVersion");
        if (temporary) {
          temporary.close();
          this.view = undefined;
          this.resetDocument();
        }
        return {
          available: true,
          runtime: { bun: Bun.version },
          backend: "chrome",
          browser,
          capabilities: {
            cdp: true,
            dom: true,
            css: true,
            screenshots: true,
            console: true,
            network: true,
          },
        };
      }
      case "open": {
        const view = await this.newView(command.viewport ?? { width: 1440, height: 900 });
        await view.navigate(command.url);
        return {
          url: view.url,
          title: view.title,
          viewport: this.viewport,
          generation: this.generation,
        };
      }
      case "inspect": {
        const nodes = await this.nodesForTarget(command.target);
        return {
          matches: await Promise.all(nodes.slice(0, 20).map((nodeId) => this.inspectNode(nodeId))),
          total: nodes.length,
        };
      }
      case "styles":
        return this.styles(command);
      case "screenshot": {
        const view = this.requireView();
        await mkdir(dirname(command.outputPath), { recursive: true });
        if (!command.target) {
          const image = await view.screenshot({ format: "png", encoding: "buffer", quality: 80 });
          await Bun.write(command.outputPath, image);
        } else {
          const nodeId = await this.singleNode(command.target);
          await this.cdp("DOM.scrollIntoViewIfNeeded", { nodeId });
          const box = await this.callOnNode<{
            x: number;
            y: number;
            width: number;
            height: number;
            pageX: number;
            pageY: number;
          }>(
            nodeId,
            `function () {
              const rect = this.getBoundingClientRect();
              return {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                pageX: window.scrollX,
                pageY: window.scrollY,
              };
            }`,
          );
          if (box.width <= 0 || box.height <= 0) {
            throw new Error("Target has an empty box and cannot be captured");
          }
          const result = await this.cdp<{ data: string }>("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: true,
            clip: {
              x: box.x + box.pageX,
              y: box.y + box.pageY,
              width: box.width,
              height: box.height,
              scale: 1,
            },
          });
          await Bun.write(command.outputPath, Buffer.from(result.data, "base64"));
        }
        return { path: command.outputPath };
      }
      case "interact":
        return this.interact(command);
      case "console": {
        const cursor = command.cursor ?? 0;
        const levels = command.levels ? new Set(command.levels) : undefined;
        const entries = this.consoleEntries.filter(
          (entry) => entry.cursor > cursor && (!levels || levels.has(entry.level)),
        );
        return { entries, nextCursor: this.nextConsoleCursor - 1 };
      }
      case "network": {
        const cursor = command.cursor ?? 0;
        const entries = this.networkEntries.filter(
          (entry) =>
            entry.cursor > cursor &&
            (!command.failedOnly || entry.failed || (entry.status ?? 0) >= 400),
        );
        return { entries, nextCursor: this.nextNetworkCursor - 1 };
      }
      case "close":
        this.view?.close();
        this.view = undefined;
        this.resetDocument();
        return { closed: true };
    }
  }

  close(): void {
    this.view?.close();
    this.view = undefined;
  }
}

function errorResponse(id: number, error: unknown): HostResponse {
  const value = error instanceof Error ? error : new Error(String(error));
  return {
    id,
    ok: false,
    error: {
      message: value.message,
      ...(value.name && value.name !== "Error" ? { code: value.name } : {}),
    },
  };
}

const runtime = new BrowserRuntime();
const lines = createInterface({ input: process.stdin });
let queue = Promise.resolve();

lines.on("line", (line) => {
  queue = queue.then(async () => {
    let request: HostRequest;
    try {
      request = JSON.parse(line) as HostRequest;
    } catch (error) {
      process.stderr.write(`browser_inspector invalid request: ${String(error)}\n`);
      return;
    }
    let response: HostResponse;
    try {
      response = { id: request.id, ok: true, result: await runtime.dispatch(request.command) };
    } catch (error) {
      response = errorResponse(request.id, error);
    }
    process.stdout.write(`${JSON.stringify(response)}\n`);
  });
});

lines.once("close", () => runtime.close());
