import { resolve } from "node:path";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { type ExtensionAPI, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { editContinuationDetailed, editManyContinuationDetailed } from "./src/edit.ts";
import { inspect } from "./src/inspect.ts";
import {
  supportedLanguageDescription,
  supportedLanguageIds,
  type LanguageId,
} from "./src/language-profile.ts";
import { locateDetailed } from "./src/locate.ts";
import { createMetrics, record } from "./src/metrics.ts";
import { HandleStore, type NodeHandle } from "./src/node-handles.ts";
import { shutdownParserCaches, startParserCaches } from "./src/parser.ts";
import {
  continuation,
  failure,
  isContinuation,
  responseText,
  type LocateCandidate,
  type SyntaxHandle,
  type SyntaxRequest,
  type SyntaxResponse,
} from "./src/protocol.ts";
import { syntaxSearchDetailed } from "./src/syntax-search.ts";

const TOOL_SELECTION_GUIDANCE = `When modifying existing ${supportedLanguageDescription} source, use locate to identify the target and return either its body or compact structural cards; use read/edit for new, generated, configuration, or unsupported files.`;

const GUIDANCE = [
  `For existing ${supportedLanguageDescription} source, use astrolabe before read or edit. Do not use read/edit for a supported existing source file unless astrolabe reports unsupported, generated, or configuration content.`,
  "For an edit intent or known symbol, use locate first. If locate returns mode=source, use that source and continuation directly with replace; do not inspect the same candidate again. If it returns mode=cards, inspect the selected card before replacing. When several same-file cards must be edited, inspect them together with inspect_many and then use replace_many. Use search or outline inspection only when locate cannot identify the target.",
  "Use read or normal edits for unsupported languages, generated/configuration files, new files, or when astrolabe explicitly reports that the target is not applicable.",
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
    action: Type.Literal("inspect_many"),
    targets: Type.Array(
      Type.Object({ continuation: Type.Object({ token: Type.String() }) }),
      { minItems: 1, maxItems: 10 },
    ),
  }),
  Type.Object({
    action: Type.Literal("locate"),
    scope: Type.String({ description: "Existing supported source file or directory scope" }),
    symbols: Type.Optional(Type.Array(Type.String(), { maxItems: 10 })),
    terms: Type.Optional(Type.Array(Type.String(), { maxItems: 10 })),
    maxCandidates: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
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
      token: Type.String({ description: "Continuation whose source has been returned by Astrolabe" }),
    }),
    replacement: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("replace_many"),
    targets: Type.Array(
      Type.Object({
        continuation: Type.Object({ token: Type.String() }),
        replacement: Type.String(),
      }),
      { minItems: 1 },
    ),
  }),
]);

function normalizePath(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path;
}

function resultText(result: { content: readonly unknown[] }): string {
  const first = result.content[0] as { text?: string } | undefined;
  return typeof first?.text === "string" ? first.text : "";
}

const AUTO_SOURCE_LIMIT = 6_000;

function includeSource(matches: Awaited<ReturnType<typeof locateDetailed>>): boolean {
  const first = matches[0];
  const second = matches[1];
  return Boolean(
    first &&
    first.score >= 90 &&
    (!second || first.score - second.score >= 50) &&
    Buffer.byteLength(first.source) <= AUTO_SOURCE_LIMIT,
  );
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
  return [...new Set([...output.matchAll(/node=(n\d+)/g)].map((match) => match[1]))].flatMap(
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
  if (request.action === "locate") {
    if ((request.symbols?.length ?? 0) + (request.terms?.length ?? 0) === 0) {
      return failure(
        "locate",
        "locate_requires_hint",
        "Provide at least one symbol or term to locate an edit target.",
      );
    }
    const maxCandidates = request.maxCandidates ?? 3;
    const matches = await locateDetailed(
      { ...request, scope: normalizePath(request.scope) },
      cwd,
      handles,
    );
    if (matches.length === 0) {
      return failure(
        "locate",
        "no_candidates",
        "No structural declarations matched the supplied symbols or terms.",
      );
    }
    const includeTopSource = includeSource(matches);
    if (includeTopSource && matches[0]) handles.markSourceInspected(matches[0].handle.id);
    const candidates: LocateCandidate[] = matches
      .slice(0, maxCandidates)
      .flatMap((match, index) => {
        const handle = handleResponse(handles, match.handle);
        return handle
          ? [
              {
                continuation: handle.continuation,
                path: match.path,
                type: match.handle.type,
                name: match.name,
                ...(match.parent ? { parent: match.parent } : {}),
                signature: match.signature,
                flow: match.flow,
                range: handle.range,
                ...(includeTopSource && index === 0 ? { source: match.source } : {}),
              },
            ]
          : [];
      });
    const directCandidate = includeTopSource ? candidates[0] : undefined;
    return {
      ok: true,
      action: "locate",
      data: {
        candidateCount: candidates.length,
        mode: includeTopSource ? "source" : "cards",
        candidates,
      },
      ...(directCandidate
        ? {
            next: [
              {
                action: "replace" as const,
                continuation: directCandidate.continuation,
                replacement: "",
              },
            ],
          }
        : {}),
    };
  }

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

  if (request.action === "inspect_many") {
    if (request.targets.length === 0) {
      return failure("inspect_many", "inspect_many_requires_target", "Provide at least one target.");
    }
    const resolved = request.targets.map((target) => ({
      continuation: target.continuation,
      handle: isContinuation(target.continuation)
        ? handles.resolveContinuation(target.continuation.token)
        : undefined,
    }));
    if (resolved.some((target) => !target.handle)) {
      return failure(
        "inspect_many",
        "invalid_continuation",
        "Every continuation must be valid and unexpired.",
      );
    }
    const firstPath = resolved[0]!.handle!.path;
    if (resolved.some((target) => target.handle!.path !== firstPath)) {
      return failure(
        "inspect_many",
        "mixed_paths",
        "inspect_many requires all targets to belong to the same file.",
      );
    }

    const sources: Array<{
      continuation: { token: string };
      path: string;
      type: string;
      source: string;
    }> = [];
    for (const target of resolved) {
      const handle = target.handle!;
      const output = await inspect(
        { path: handle.path, nodeId: handle.id, view: "source" },
        cwd,
        handles,
      );
      if (output.startsWith("stale_node:")) {
        return failure("inspect_many", "stale_node", output, [
          { action: "inspect", continuation: target.continuation, detail: "source" },
        ]);
      }
      sources.push({
        continuation: target.continuation,
        path: handle.path,
        type: handle.type,
        source: output,
      });
    }
    return {
      ok: true,
      action: "inspect_many",
      data: { sources },
      next: [
        {
          action: "replace_many",
          targets: sources.map((source) => ({
            continuation: source.continuation,
            replacement: "",
          })),
        },
      ],
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
      ...(detail === "source" ? { source: output } : { outline: output }),
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

  if (request.action === "replace_many") {
    const firstTarget = request.targets[0];
    if (!firstTarget || !isContinuation(firstTarget.continuation)) {
      return failure(
        "replace_many",
        "invalid_continuation",
        "Pass every target continuation unchanged.",
      );
    }
    for (const candidate of request.targets) {
      if (!isContinuation(candidate.continuation)) {
        return failure(
          "replace_many",
          "invalid_continuation",
          "Pass every target continuation unchanged.",
        );
      }
      const handle = handles.resolveContinuation(candidate.continuation.token);
      if (!handle) {
        return failure(
          "replace_many",
          "invalid_continuation",
          "The continuation has expired; inspect source again.",
        );
      }
      if (handle.inspectionStage !== "source") {
        return failure(
          "replace_many",
          "source_not_inspected",
          "Inspect every selected source before replacing it.",
          [{ action: "inspect", continuation: candidate.continuation, detail: "source" }],
        );
      }
    }
    const target = handles.resolveContinuation(firstTarget.continuation.token);
    if (!target) {
      return failure(
        "replace_many",
        "invalid_continuation",
        "The continuation has expired; inspect source again.",
      );
    }
    return withFileMutationQueue(resolve(cwd, target.path), async () => {
      const result = await editManyContinuationDetailed(request, cwd, handles);
      if (!result.message.startsWith("edited ")) {
        return failure(
          "replace_many",
          result.message.split(":")[0] ?? "replace_failed",
          result.message,
          [{ action: "inspect", continuation: firstTarget.continuation, detail: "source" }],
        );
      }
      const updated = result.details?.recommendedNextInspectionTarget
        ? handles.get(result.details.recommendedNextInspectionTarget)
        : undefined;
      const nextHandle = updated ? handleResponse(handles, updated) : undefined;
      return {
        ok: true,
        action: "replace_many" as const,
        message: "ok",
        ...(nextHandle
          ? {
              next: [
                {
                  action: "inspect" as const,
                  continuation: nextHandle.continuation,
                  detail: "source",
                },
              ],
            }
          : {}),
      };
    });
  }

  if (!isContinuation(request.continuation)) {
    return failure("replace", "invalid_continuation", "Pass the source continuation unchanged.");
  }
  const target = handles.resolveContinuation(request.continuation.token);
  if (!target) {
    return failure(
      "replace",
      "invalid_continuation",
      "The continuation has expired; inspect source again.",
    );
  }
  if (target.inspectionStage !== "source") {
    return failure(
      "replace",
      "source_not_inspected",
      "Inspect the selected source before replacing it.",
      [{ action: "inspect", continuation: request.continuation, detail: "source" }],
    );
  }
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
      message: "ok",
      ...(nextHandle
        ? {
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
    const selectedTools = event.systemPromptOptions.selectedTools ?? [];
    const guidance = selectedTools.includes("astrolabe")
      ? `${TOOL_SELECTION_GUIDANCE} ${GUIDANCE.join(" ")}`
      : TOOL_SELECTION_GUIDANCE;
    return { systemPrompt: `${event.systemPrompt}\n\n${guidance}` };
  });
  pi.registerTool({
    name: "astrolabe",
    label: "Astrolabe",
    description: `Use first for existing ${supportedLanguageDescription} source instead of read/edit: locate or inspect syntax, batch selected reads, and safely replace validated nodes. Avoid for new, generated, configuration, or unsupported files.`,
    promptSnippet:
      "Prefer for existing supported source; locate, batch inspections when useful, and safely replace validated syntax",
    promptGuidelines: GUIDANCE,
    parameters: actionSchema,
    renderCall(args, theme) {
      const request = args as SyntaxRequest;
      const target =
        request.action === "search" || request.action === "locate"
          ? request.scope
          : request.action === "inspect"
            ? (request.path ?? "continuation")
            : request.action === "inspect_many"
              ? `${request.targets.length} continuations`
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
      const request = params as SyntaxRequest;
      let response: SyntaxResponse;
      try {
        response = await dispatch(request, ctx.cwd, handles);
      } catch (error) {
        response = failure(request.action, "syntax_error", String(error));
      }
      const text = responseText(response);
      record(metrics, request.action, JSON.stringify(params).length, text, start);
      return {
        content: [{ type: "text", text }],
        details: { metrics },
        ...(response.ok ? {} : { isError: true }),
      };
    },
  });
}
