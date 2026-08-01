import { resolve } from "node:path";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { type ExtensionAPI, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { editDetailed } from "./src/edit.ts";
import { inspect } from "./src/inspect.ts";
import { syntaxSearch } from "./src/syntax-search.ts";
import { HandleStore } from "./src/node-handles.ts";
import { shutdownParserCaches, startParserCaches } from "./src/parser.ts";
import { createMetrics, record } from "./src/metrics.ts";
import { supportedLanguageIds } from "./src/language-profile.ts";

const INSPECT_GUIDANCE = [
  "When an existing file is in a supported language and its code structure can answer the question, let syntax_inspect be the map before using read as the microscope.",
  "For an unfamiliar supported source file, call syntax_inspect with view=outline and no nodeId first; do not begin by consuming the whole file when a declaration map will do.",
  "Treat outline as the index, structure as the cross-section, and source as the smallest necessary specimen: drill into returned nodeIds and fetch source only for the declarations whose bodies matter.",
  "For a large change, do not route around syntax_inspect merely because the final diff is large. Map the related declarations, then decompose the work into a sequence of local syntax edits and inspect the intermediate state when it reduces uncertainty.",
  "Avoid redundant inspections: reuse still-valid handles, request enough outline context to cover related nodes, and use edit results or updated handles when available. Re-inspect after edits when handles or surrounding structure may have changed.",
  "Use read for unsupported languages, generated text, configuration, or files where syntax structure provides no useful leverage; syntax_inspect is a guide to the code, not a ritual that replaces judgment.",
];

const SEARCH_GUIDANCE = [
  "Use syntax_search for exact TypeScript declarations, calls, or imports after broad text search has identified a likely area.",
  "Use kind=function, call, or import; add name or source filters when possible.",
  "Search results return nodeIds that can be expanded with syntax_inspect structure or source.",
  "syntax_search is not a replacement for text search, type checking, or tests.",
];

const REPLACE_GUIDANCE = [
  "Use syntax_replace after syntax_inspect source has confirmed the exact nodeId when one or a few local syntax nodes need editing.",
  "Use normal diff/patch editing for new files, unsupported or non-structural files, and changes whose structure provides no useful leverage. For broad or cross-cutting changes in supported source, prefer a sequence of local syntax_replace operations when that makes intermediate validation useful.",
  "After syntax_replace succeeds, run syntax_inspect again before another structural edit because prior nodeIds may be stale.",
  "syntax_replace validates syntax, not types; run the project type checker and tests separately after the edit batch.",
];

function normalizePath(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path;
}

function resultText(result: { content: readonly unknown[] }): string {
  const first = result.content[0] as { type?: string; text?: string } | undefined;
  return first?.type === "text" && typeof first.text === "string" ? first.text : "";
}

export default function treeStructuralEditExtension(pi: ExtensionAPI): void {
  startParserCaches();
  const handles = new HandleStore();
  const metrics = createMetrics();

  pi.on("session_shutdown", async () => {
    handles.clear();
    await shutdownParserCaches();
  });

  pi.registerTool({
    name: "syntax_inspect",
    label: "Syntax Inspect",
    description:
      "Map a TypeScript file by declarations, drill into selected syntax nodes, and return source only for a selected nodeId. Start with outline; use structure before source.",
    promptSnippet:
      "Read TypeScript structurally: outline declarations, drill into nodeIds, then fetch only the needed node source",
    promptGuidelines: INSPECT_GUIDANCE,
    parameters: Type.Object({
      path: Type.String({ description: "Existing file path relative to the working directory" }),
      language: Type.Optional(
        StringEnum(supportedLanguageIds, {
          description: "Explicit language override; otherwise inferred from the extension",
        }),
      ),
      nodeId: Type.Optional(Type.String({ description: "Node handle returned by syntax_inspect" })),
      view: Type.Optional(
        StringEnum(["outline", "structure", "source"] as const, {
          description:
            "outline maps declarations, structure drills into a node, source returns one selected node body",
        }),
      ),
      depth: Type.Optional(Type.Integer({ minimum: 0, maximum: 12 })),
    }),
    renderCall(args, theme) {
      const view = args.view ?? "outline";
      const target = args.nodeId ? ` nodeId=${args.nodeId}` : "";
      return new Text(
        `${theme.fg("toolTitle", theme.bold("inspect "))}${theme.fg("accent", args.path)}${theme.fg("dim", ` ${view}${target}`)}`,
        0,
        0,
      );
    },
    renderResult(result, { isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("warning", "Inspecting..."), 0, 0);
      const output = resultText(result);
      const failed = context.isError || /^(?:Error:|stale_node:)/.test(output);
      if (failed) return new Text(theme.fg("error", output || "Inspect failed"), 0, 0);
      const lines = output === "" ? 0 : output.split("\n").length;
      return new Text(
        theme.fg("success", `${context.args.view ?? "outline"}: ${lines} line(s)`),
        0,
        0,
      );
    },
    async execute(_id, params, _signal, _update, ctx) {
      const start = Date.now();
      try {
        const output = await inspect(
          { ...params, path: normalizePath(params.path) },
          ctx.cwd,
          handles,
        );
        record(metrics, JSON.stringify(params).length, output, start);
        return { content: [{ type: "text", text: output }], details: { metrics } };
      } catch (error) {
        const text = String(error);
        record(metrics, JSON.stringify(params).length, text, start);
        return { content: [{ type: "text", text }], details: { metrics }, isError: true };
      }
    },
  });

  pi.registerTool({
    name: "syntax_search",
    label: "Syntax Search",
    description:
      "Search a TypeScript file with Tree-sitter Query for function declarations, calls, or imports and return position-aware node handles.",
    promptSnippet: "Find exact TypeScript declarations, calls, or imports with Tree-sitter Query",
    promptGuidelines: SEARCH_GUIDANCE,
    parameters: Type.Object({
      path: Type.String({ description: "Existing file path relative to the working directory" }),
      language: Type.Optional(
        StringEnum(supportedLanguageIds, {
          description: "Explicit language override; otherwise inferred from the extension",
        }),
      ),
      kind: StringEnum(["function", "call", "import"] as const, {
        description: "Syntax construct to find",
      }),
      name: Type.Optional(Type.String({ description: "Exact declaration or call name" })),
      source: Type.Optional(
        Type.String({ description: "Exact import module source, without surrounding quotes" }),
      ),
    }),
    renderCall(args, theme) {
      const filters = [args.name && `name=${args.name}`, args.source && `source=${args.source}`]
        .filter(Boolean)
        .join(" ");
      return new Text(
        `${theme.fg("toolTitle", theme.bold("search "))}${theme.fg("accent", args.path)}${theme.fg("dim", ` ${args.kind}${filters ? ` ${filters}` : ""}`)}`,
        0,
        0,
      );
    },
    renderResult(result, { isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("warning", "Searching..."), 0, 0);
      const output = resultText(result);
      const failed = context.isError || output.startsWith("Error:");
      const count = output === "(no syntax matches)" ? 0 : output ? output.split("\n").length : 0;
      return new Text(
        theme.fg(failed ? "error" : "success", failed ? output : `search: ${count} match(es)`),
        0,
        0,
      );
    },
    async execute(_id, params, _signal, _update, ctx) {
      const start = Date.now();
      try {
        const output = await syntaxSearch(
          { ...params, path: normalizePath(params.path) },
          ctx.cwd,
          handles,
        );
        record(metrics, JSON.stringify(params).length, output, start);
        return { content: [{ type: "text", text: output }], details: { metrics } };
      } catch (error) {
        const text = String(error);
        record(metrics, JSON.stringify(params).length, text, start);
        return { content: [{ type: "text", text }], details: { metrics }, isError: true };
      }
    },
  });

  pi.registerTool({
    name: "syntax_replace",
    label: "Syntax Edit",
    description:
      "Replace one previously inspected syntax node, reject stale or cross-grammar handles, reparse incrementally, and save atomically. For broad changes in supported source, decompose the work into local syntax edits; use normal diff editing for new or non-structural files.",
    promptSnippet:
      "Edit one confirmed TypeScript node safely; use normal diff for broad or multi-location changes",
    promptGuidelines: REPLACE_GUIDANCE,
    parameters: Type.Object({
      path: Type.String({ description: "Existing file path relative to the working directory" }),
      nodeId: Type.String({
        description: "Exact node handle confirmed with syntax_inspect source",
      }),
      replacement: Type.String({
        description: "Complete replacement source for the selected node",
      }),
    }),
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("edit "))}${theme.fg("accent", args.path)}${theme.fg("dim", ` nodeId=${args.nodeId}`)}`,
        0,
        0,
      );
    },
    renderResult(result, { isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("warning", "Editing..."), 0, 0);
      const output = resultText(result);
      const failed = context.isError || !output.startsWith("edited ");
      return new Text(theme.fg(failed ? "error" : "success", output || "Edit failed"), 0, 0);
    },
    async execute(_id, params, _signal, _update, ctx) {
      const start = Date.now();
      const targetPath = resolve(ctx.cwd, normalizePath(params.path));
      return withFileMutationQueue(targetPath, async () => {
        try {
          const result = await editDetailed(
            { ...params, path: normalizePath(params.path) },
            ctx.cwd,
            handles,
          );
          record(metrics, JSON.stringify(params).length, result.message, start);
          return {
            content: [{ type: "text", text: result.message }],
            details: { metrics, ...(result.details ? { edit: result.details } : {}) },
          };
        } catch (error) {
          const text = String(error);
          record(metrics, JSON.stringify(params).length, text, start);
          return { content: [{ type: "text", text }], details: { metrics }, isError: true };
        }
      });
    },
  });
}
