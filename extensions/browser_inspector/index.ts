import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { BrowserHostClient } from "./client.ts";
import type { BrowserCommand, BrowserHost, BrowserTarget } from "./protocol.ts";

const TOOL_NAME = "browser_inspector";

const TargetSchema = Type.Union([
  Type.Object({ ref: Type.String({ description: "Element ref returned by inspect" }) }),
  Type.Object({ selector: Type.String({ description: "CSS selector" }) }),
  Type.Object({
    point: Type.Object({
      x: Type.Number({ description: "Viewport x coordinate" }),
      y: Type.Number({ description: "Viewport y coordinate" }),
    }),
  }),
]);

let hostFactory: () => BrowserHost = () => new BrowserHostClient();

export function setBrowserHostFactoryForTests(factory?: () => BrowserHost): void {
  hostFactory = factory ?? (() => new BrowserHostClient());
}

function required<T>(value: T | undefined, name: string, action: string): T {
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name} is required for ${action}`);
  }
  return value;
}

function target(value: BrowserTarget | undefined, action: string): BrowserTarget {
  return required(value, "target", action);
}

function screenshotPath(cwd: string, requested: string | undefined, toolCallId: string): string {
  if (requested) return resolve(cwd, requested);
  const id = toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(tmpdir(), "pi-kit-browser-inspector", `${Date.now()}-${id}.png`);
}

function buildCommand(
  params: {
    action: BrowserCommand["action"];
    url?: string;
    viewport?: { width: number; height: number };
    target?: BrowserTarget;
    properties?: string[];
    preset?: "layout" | "typography" | "paint" | "all";
    operation?: "click" | "type" | "press" | "scroll" | "resize" | "reload" | "back" | "forward";
    text?: string;
    key?: string;
    dx?: number;
    dy?: number;
    width?: number;
    height?: number;
    cursor?: number;
    levels?: string[];
    failedOnly?: boolean;
    path?: string;
  },
  cwd: string,
  toolCallId: string,
): BrowserCommand {
  switch (params.action) {
    case "probe":
      return { action: "probe" };
    case "open":
      return {
        action: "open",
        url: required(params.url, "url", "open"),
        ...(params.viewport ? { viewport: params.viewport } : {}),
      };
    case "inspect":
      return { action: "inspect", target: target(params.target, "inspect") };
    case "styles":
      return {
        action: "styles",
        target: target(params.target, "styles"),
        ...(params.properties ? { properties: params.properties } : {}),
        ...(params.preset ? { preset: params.preset } : {}),
      };
    case "screenshot":
      return {
        action: "screenshot",
        ...(params.target ? { target: params.target } : {}),
        outputPath: screenshotPath(cwd, params.path, toolCallId),
      };
    case "interact":
      return {
        action: "interact",
        operation: required(params.operation, "operation", "interact"),
        ...(params.target ? { target: params.target } : {}),
        ...(params.text !== undefined ? { text: params.text } : {}),
        ...(params.key !== undefined ? { key: params.key } : {}),
        ...(params.dx !== undefined ? { dx: params.dx } : {}),
        ...(params.dy !== undefined ? { dy: params.dy } : {}),
        ...(params.width !== undefined ? { width: params.width } : {}),
        ...(params.height !== undefined ? { height: params.height } : {}),
      };
    case "console":
      return {
        action: "console",
        ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
        ...(params.levels ? { levels: params.levels } : {}),
      };
    case "network":
      return {
        action: "network",
        ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
        ...(params.failedOnly !== undefined ? { failedOnly: params.failedOnly } : {}),
      };
    case "close":
      return { action: "close" };
  }
}

export default function browserInspectorExtension(pi: ExtensionAPI): void {
  let host: BrowserHost | undefined;
  const getHost = (): BrowserHost => (host ??= hostFactory());

  pi.registerTool({
    name: TOOL_NAME,
    label: "Browser Inspector",
    description:
      "Inspect and interact with a running web UI through an isolated headless Chrome managed by a Bun.WebView sidecar. Use after web UI changes and when runtime DOM, computed CSS, layout, console, network, or rendered output matters. Prefer inspect/styles/network/console over inferring browser behavior from source files or generated CSS. Element refs are short-lived and become stale after navigation. Use terminal or background_process for servers and non-browser commands.",
    promptGuidelines: [
      "For visual or layout changes, verify the rendered browser state before claiming completion when the browser is available.",
      "Use inspect to resolve a selector or viewport point to element refs, then reuse those refs for styles, screenshots, and interactions until navigation invalidates them.",
      "Use styles when classes or CSS rules appear correct but the rendered result is wrong; it reports computed values, matched declarations, and unresolved custom properties.",
      "Use network and console cursors to inspect only new runtime events during short edit/reload loops.",
      "Do not use browser_inspector to manage dev servers; use terminal or background_process for process lifecycle.",
    ],
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("probe"),
        Type.Literal("open"),
        Type.Literal("inspect"),
        Type.Literal("styles"),
        Type.Literal("screenshot"),
        Type.Literal("interact"),
        Type.Literal("console"),
        Type.Literal("network"),
        Type.Literal("close"),
      ]),
      url: Type.Optional(Type.String({ description: "URL for open" })),
      viewport: Type.Optional(
        Type.Object({
          width: Type.Number({ minimum: 1, maximum: 16384 }),
          height: Type.Number({ minimum: 1, maximum: 16384 }),
        }),
      ),
      target: Type.Optional(TargetSchema),
      properties: Type.Optional(
        Type.Array(Type.String(), { description: "CSS properties for styles" }),
      ),
      preset: Type.Optional(
        Type.Union([
          Type.Literal("layout"),
          Type.Literal("typography"),
          Type.Literal("paint"),
          Type.Literal("all"),
        ]),
      ),
      operation: Type.Optional(
        Type.Union([
          Type.Literal("click"),
          Type.Literal("type"),
          Type.Literal("press"),
          Type.Literal("scroll"),
          Type.Literal("resize"),
          Type.Literal("reload"),
          Type.Literal("back"),
          Type.Literal("forward"),
        ]),
      ),
      text: Type.Optional(Type.String({ description: "Text for interact/type" })),
      key: Type.Optional(Type.String({ description: "Key for interact/press" })),
      dx: Type.Optional(Type.Number({ description: "Horizontal scroll delta" })),
      dy: Type.Optional(Type.Number({ description: "Vertical scroll delta" })),
      width: Type.Optional(Type.Number({ minimum: 1, maximum: 16384 })),
      height: Type.Optional(Type.Number({ minimum: 1, maximum: 16384 })),
      cursor: Type.Optional(Type.Number({ minimum: 0 })),
      levels: Type.Optional(
        Type.Array(Type.String(), { description: "Console levels to include" }),
      ),
      failedOnly: Type.Optional(
        Type.Boolean({ description: "Only failed or HTTP >=400 network entries" }),
      ),
      path: Type.Optional(
        Type.String({ description: "Screenshot output path; defaults to a temporary PNG" }),
      ),
    }),
    renderCall(args, theme) {
      const detail =
        args.action === "open"
          ? args.url
          : args.action === "interact"
            ? args.operation
            : args.target && "selector" in args.target
              ? args.target.selector
              : args.target && "ref" in args.target
                ? args.target.ref
                : "";
      return new Text(
        `${theme.fg("toolTitle", theme.bold(TOOL_NAME))} ${theme.fg("accent", args.action)}${detail ? ` ${theme.fg("dim", String(detail))}` : ""}`,
        0,
        0,
      );
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("warning", "Inspecting browser..."), 0, 0);
      const content = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text ?? "")
        .join("\n");
      const summary = context.isError
        ? content.split("\n")[0] || "Browser inspection failed"
        : content.split("\n")[0] || "Done";
      return new Text(
        theme.fg(context.isError ? "error" : "toolOutput", expanded ? content : summary),
        0,
        0,
      );
    },
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const command = buildCommand(params, ctx.cwd, toolCallId);
      const result = await getHost().request(command);
      const text =
        command.action === "screenshot" && result && typeof result === "object" && "path" in result
          ? `Screenshot: ${String((result as { path: unknown }).path)}`
          : JSON.stringify(result, null, 2);
      return {
        content: [{ type: "text" as const, text }],
        details: result,
      };
    },
  });

  pi.on("session_shutdown", async () => {
    const active = host;
    host = undefined;
    await active?.dispose();
  });
}
