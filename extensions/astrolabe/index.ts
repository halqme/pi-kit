import { resolve } from "node:path";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { type ExtensionAPI, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { editContinuationDetailed } from "./src/edit.ts";
import { inspect } from "./src/inspect.ts";
import { supportedLanguageIds, type LanguageId } from "./src/language-profile.ts";
import { createMetrics, record } from "./src/metrics.ts";
import { HandleStore, type NodeHandle } from "./src/node-handles.ts";
import { shutdownParserCaches, startParserCaches } from "./src/parser.ts";
import {
  continuation,
  failure,
  isContinuation,
  responseText,
  type SyntaxHandle,
  type SyntaxRequest,
  type SyntaxResponse,
} from "./src/protocol.ts";
import { syntaxSearchDetailed } from "./src/syntax-search.ts";

const GUIDANCE = [
  "Use astrolabe for supported existing source: search accepts a file or directory scope; inspect returns the selected source without manual outline/structure transitions.",
  "Pass the continuation object returned in a result unchanged to inspect or replace. Replace revalidates the target source, node type, range, and context before writing.",
  "Use read or normal edits only for unsupported, generated, configuration, or new files—not after a syntax error. Use the returned next action to recover.",
];

const actionSchema = Type.Union([
  Type.Object({
    action: Type.Literal("inspect"),
    continuation: Type.Optional(Type.Object({ token: Type.String() })),
    path: Type.Optional(Type.String()),
    language: Type.Optional(StringEnum(supportedLanguageIds)),
    detail: Type.Optional(StringEnum(["outline", "source"] as const)),
    depth: Type.Optional(Type.Integer({ minimum: 0, maximum: 12 })),
  }),
  Type.Object({
    action: Type.Literal("search"),
    scope: Type.String({ description: "Existing supported source file or directory scope" }),
    language: Type.Optional(StringEnum(supportedLanguageIds)),
    kind: StringEnum(["function", "call", "import"] as const),
    name: Type.Optional(Type.String()),
    source: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("replace"),
    continuation: Type.Object({
      token: Type.String({ description: "Continuation returned by inspect with source detail" }),
    }),
    replacement: Type.String(),
  }),
]);

function normalizePath(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path;
}

function resultText(result: { content: readonly unknown[] }): string {
  const first = result.content[0] as { text?: string } | undefined;
  return typeof first?.text === "string" ? first.text : "";
}

function handleResponse(handles: HandleStore, handle: NodeHandle): SyntaxHandle | undefined {
  const token = handles.issueContinuation(handle.id);
  if (!token) return undefined;
  return {
    continuation: continuation(token),
    path: handle.path,
    type: handle.type,
    range: { start: handle.startPosition, end: handle.endPosition },
    capabilities: ["inspect", "source", "replace"],
  };
}

function outlineRequest(path: string, language: LanguageId | undefined): SyntaxRequest {
  return { action: "inspect", path, ...(language ? { language } : {}), detail: "outline" };
}

function handlesFromOutput(handles: HandleStore, output: string): SyntaxHandle[] {
  return [...new Set([...output.matchAll(/nodeId=(n\d+)/g)].map((match) => match[1]))].flatMap(
    (id) => {
      const handle = id ? handles.get(id) : undefined;
      const result = handle ? handleResponse(handles, handle) : undefined;
      return result ? [result] : [];
    },
  );
}

async function dispatch(
  request: SyntaxRequest,
  cwd: string,
  handles: HandleStore,
): Promise<SyntaxResponse> {
  if (request.action === "search") {
    const scope = normalizePath(request.scope);
    const matches = await syntaxSearchDetailed({ ...request, scope }, cwd, handles);
    const resultHandles = matches.flatMap((match) => {
      const result = handleResponse(handles, match.handle);
      return result ? [result] : [];
    });
    return {
      ok: true,
      action: "search",
      data: { matchCount: matches.length, matches: matches.map((match) => match.description) },
      ...(resultHandles.length > 0 ? { handles: resultHandles } : {}),
      ...(resultHandles.length > 0
        ? {
            next: resultHandles.map((handle) => ({
              action: "inspect" as const,
              continuation: handle.continuation,
              detail: "source" as const,
            })),
          }
        : {}),
    };
  }

  if (request.action === "inspect") {
    const detail = request.detail ?? "outline";
    if (request.continuation && !isContinuation(request.continuation)) {
      return failure(
        "inspect",
        "invalid_continuation",
        "The continuation must be passed unchanged.",
      );
    }
    const handle = request.continuation
      ? handles.resolveContinuation(request.continuation.token)
      : undefined;
    if (request.continuation && !handle) {
      return failure(
        "inspect",
        "invalid_continuation",
        "The continuation has expired; search or outline again.",
      );
    }
    if (!handle && !request.path) {
      return failure(
        "inspect",
        "inspect_requires_target",
        "Provide a source path or a continuation.",
      );
    }
    if (!handle && detail === "source") {
      return failure(
        "inspect",
        "source_requires_target",
        "Request outline first or pass a search continuation.",
        [outlineRequest(request.path as string, request.language)],
      );
    }
    const path = handle?.path ?? normalizePath(request.path as string);
    const inspectParams = {
      path,
      ...(handle ? { nodeId: handle.id } : {}),
      ...(request.language ? { language: request.language } : {}),
      ...(request.depth !== undefined ? { depth: request.depth } : {}),
    };
    const structure =
      detail === "source" && handle
        ? await inspect({ ...inspectParams, view: "structure" }, cwd, handles)
        : undefined;
    const output = await inspect({ ...inspectParams, view: detail }, cwd, handles);
    if (output.startsWith("stale_node:")) {
      return failure(
        "inspect",
        "stale_node",
        output,
        request.path ? [outlineRequest(request.path, request.language)] : [],
      );
    }
    const responseHandles =
      detail === "source" && handle
        ? [handleResponse(handles, handle)].filter((item): item is SyntaxHandle => Boolean(item))
        : handlesFromOutput(handles, output);
    return {
      ok: true,
      action: "inspect",
      data:
        detail === "source"
          ? { source: output, ...(structure ? { structure } : {}) }
          : { outline: output },
      ...(responseHandles.length > 0 ? { handles: responseHandles } : {}),
      ...(detail === "outline" && responseHandles.length > 0
        ? {
            next: responseHandles.map((item) => ({
              action: "inspect" as const,
              continuation: item.continuation,
              detail: "source" as const,
            })),
          }
        : detail === "source" && responseHandles[0]
          ? {
              next: [
                {
                  action: "replace" as const,
                  continuation: responseHandles[0].continuation,
                  replacement: "",
                },
              ],
            }
          : {}),
    };
  }

  if (!isContinuation(request.continuation)) {
    return failure("replace", "invalid_continuation", "Pass the source continuation unchanged.");
  }
  const target = handles.resolveContinuation(request.continuation.token);
  if (!target)
    return failure(
      "replace",
      "invalid_continuation",
      "The continuation has expired; inspect source again.",
    );
  return withFileMutationQueue(resolve(cwd, target.path), async () => {
    const result = await editContinuationDetailed(request, cwd, handles);
    if (!result.message.startsWith("edited ")) {
      return failure("replace", result.message.split(":")[0] ?? "replace_failed", result.message, [
        { action: "inspect", continuation: request.continuation, detail: "source" },
      ]);
    }
    const updated = result.details?.recommendedNextInspectionTarget
      ? handles.get(result.details.recommendedNextInspectionTarget)
      : undefined;
    const nextHandle = updated ? handleResponse(handles, updated) : undefined;
    return {
      ok: true,
      action: "replace",
      data: { message: result.message, ...(result.details ? { edit: result.details } : {}) },
      ...(nextHandle
        ? {
            handles: [nextHandle],
            next: [{ action: "inspect", continuation: nextHandle.continuation, detail: "source" }],
          }
        : {}),
    };
  });
}

export default function treeStructuralEditExtension(pi: ExtensionAPI): void {
  startParserCaches();
  const handles = new HandleStore();
  const metrics = createMetrics();
  pi.on("session_shutdown", async () => {
    handles.clear();
    await shutdownParserCaches();
  });
  pi.on("before_agent_start", async (event) => {
    if (!(event.systemPromptOptions.selectedTools ?? []).includes("astrolabe")) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${GUIDANCE.join(" ")}` };
  });
  pi.registerTool({
    name: "astrolabe",
    label: "Astrolabe",
    description:
      "Search supported source files or directory scopes, inspect selected syntax, and safely replace validated nodes. Reuse returned continuations and next actions unchanged.",
    promptSnippet: "Search, inspect, and safely edit supported source with reusable continuations",
    promptGuidelines: GUIDANCE,
    parameters: actionSchema,
    renderCall(args, theme) {
      const request = args as SyntaxRequest;
      const target =
        request.action === "search"
          ? request.scope
          : request.action === "inspect"
            ? (request.path ?? "continuation")
            : "continuation";
      return new Text(
        `${theme.fg("toolTitle", theme.bold("astrolabe "))}${theme.fg("accent", target)}${theme.fg("dim", ` ${request.action}`)}`,
        0,
        0,
      );
    },
    renderResult(result, { isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("warning", "Processing Astrolabe..."), 0, 0);
      const output = resultText(result);
      return new Text(
        theme.fg(
          context.isError ? "error" : "success",
          context.isError ? output : "Astrolabe complete",
        ),
        0,
        0,
      );
    },
    async execute(_id, params, _signal, _update, ctx) {
      const start = Date.now();
      let response: SyntaxResponse;
      try {
        response = await dispatch(params as SyntaxRequest, ctx.cwd, handles);
      } catch (error) {
        const request = params as SyntaxRequest;
        response = failure(request.action, "syntax_error", String(error));
      }
      const text = responseText(response);
      record(metrics, JSON.stringify(params).length, text, start);
      return {
        content: [{ type: "text", text }],
        details: { response, metrics },
        ...(response.ok ? {} : { isError: true }),
      };
    },
  });
}
