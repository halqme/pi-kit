import { resolve } from "node:path";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { type ExtensionAPI, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { editContinuationDetailed } from "../code/edit.ts";
import { inspect } from "../context/inspect.ts";
import {
  adapterForIdentity,
  supportedLanguageDescription,
  supportedLanguageIds,
  type LanguageId,
} from "./language-profile.ts";
import type { LocateMatch } from "../context/locate.ts";
import { LspManager } from "./lsp.ts";
import { createMetrics, record } from "./metrics.ts";
import { HandleStore, type NodeHandle } from "./node-handles.ts";
import { shutdownParserCaches, startParserCaches } from "./parser.ts";
import {
  continuation,
  failure,
  isContinuation,
  responseText,
  type ContinuationCapability,
  type LocateCandidate,
  type SyntaxHandle,
  type SyntaxRequest,
  type SyntaxResponse,
} from "./protocol.ts";
import { renameContinuationDetailed } from "../code/rename.ts";
import { locateResolvedDetailed } from "../context/semantic-locate.ts";
import { syntaxSearchDetailed } from "../context/syntax-search.ts";

const TOOL_SELECTION_GUIDANCE = `When modifying existing ${supportedLanguageDescription} source, use astrolabe to resolve a concrete syntax target and use edit for a complete replacement; use rename for semantic symbol renames when LSP is available. Use bm25_search for unfamiliar concepts, responsibilities, or behavior; use search for exact syntax-shaped functions, calls, or imports; use ordinary text search for arbitrary literals. A no_match result from locate is a normal empty result; choose a different discovery route instead of retrying the same hints. Use read/edit for new, generated, configuration, or unsupported files.`;

const GUIDANCE = [
  `For existing ${supportedLanguageDescription} source, use astrolabe before read or edit. Do not use read/edit for a supported existing source file unless astrolabe reports unsupported, generated, or configuration content.`,
  "Choose discovery by intent: bm25_search finds conceptually relevant files and passages when the location or symbol is unknown; search finds exact syntax-shaped functions, calls, or imports; locate resolves known declaration/edit targets using Tree-sitter and optional LSP evidence. locate is not BM25 or arbitrary text search. A no_match result is a normal empty result; choose a different discovery route instead of retrying the same hints. If locate returns mode=source, use that source and continuation directly with edit; do not inspect the same candidate again. If it returns mode=cards, inspect only when the card does not provide enough context for the intended replacement. Use inspect_many only as a read-only batch for selected continuations.",
  "For a semantic symbol rename, pass the located declaration continuation to rename. The language server proposes the WorkspaceEdit; Astrolabe validates staleness and syntax before committing it.",
  "Use read or normal edits for unsupported languages, generated/configuration files, new files, or when astrolabe explicitly reports that the target is not applicable.",
];

const actionSchema = Type.Union([
  Type.Object({
    action: Type.Literal("inspect"),
    continuation: Type.Optional(
      Type.Object({
        token: Type.String({
          description: "Continuation returned by locate, search, or outline inspection",
        }),
      }),
    ),
    path: Type.Optional(
      Type.String({
        description:
          "Existing supported source path for outline inspection. Source inspection requires a continuation instead of a bare path.",
      }),
    ),
    language: Type.Optional(StringEnum(supportedLanguageIds)),
    detail: Type.Optional(
      StringEnum(["outline", "source"] as const, {
        description: "outline for a path; source for a selected continuation",
      }),
    ),
    depth: Type.Optional(Type.Integer({ minimum: 0, maximum: 12 })),
  }),
  Type.Object({
    action: Type.Literal("inspect_many"),
    targets: Type.Array(Type.Object({ continuation: Type.Object({ token: Type.String() }) }), {
      minItems: 1,
      maxItems: 10,
      description:
        "Read selected continuations concurrently. This action is read-only and never proposes a mutation batch.",
    }),
  }),
  Type.Object({
    action: Type.Literal("locate"),
    scope: Type.String({
      description:
        "Supported source file or directory; locate resolves declaration/edit targets, not arbitrary text or conceptual behavior",
    }),
    language: Type.Optional(StringEnum(supportedLanguageIds)),
    symbols: Type.Optional(Type.Array(Type.String(), { maxItems: 10 })),
    terms: Type.Optional(Type.Array(Type.String(), { maxItems: 10 })),
    maxCandidates: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 5,
        description: "Maximum ranked declaration candidates to return (1-5)",
      }),
    ),
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
    action: Type.Literal("edit"),
    continuation: Type.Object({
      token: Type.String({ description: "Continuation returned by locate, search, or inspect" }),
    }),
    replacement: Type.String({ description: "Complete replacement text for the selected node" }),
  }),
  Type.Object({
    action: Type.Literal("rename"),
    continuation: Type.Object({
      token: Type.String({ description: "Continuation for the declaration to rename" }),
    }),
    newName: Type.String({ minLength: 1 }),
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

function includeSource(matches: readonly LocateMatch[]): boolean {
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
  const capabilities: ContinuationCapability[] = ["inspect", "source", "edit"];
  if (adapterForIdentity(handle.languageId, handle.grammarId)?.lsp) capabilities.push("rename");
  return {
    continuation: continuation(token),
    path: handle.path,
    type: handle.type,
    range: { start: handle.startPosition, end: handle.endPosition },
    capabilities,
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
  lsp: LspManager,
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
    const matches = await locateResolvedDetailed(
      { ...request, scope: normalizePath(request.scope) },
      cwd,
      handles,
      lsp,
    );
    if (matches.length === 0) {
      return {
        ok: true,
        action: "locate",
        message: "no_match",
        data: { candidateCount: 0, mode: "none", candidates: [] },
      };
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
                score: match.score,
                reasons: match.reasons,
                sourceBytes: Buffer.byteLength(match.source),
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
                action: "edit" as const,
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
      return failure(
        "inspect_many",
        "inspect_many_requires_target",
        "Provide at least one target.",
      );
    }
    const resolved = request.targets.map((target, index) => ({
      index,
      continuation: target.continuation,
      handle: isContinuation(target.continuation)
        ? handles.resolveContinuation(target.continuation.token)
        : undefined,
    }));
    const inspected = await Promise.all(
      resolved.map(async (target) => {
        const handle = target.handle;
        if (!isContinuation(target.continuation)) {
          return {
            kind: "error" as const,
            index: target.index,
            continuation: target.continuation,
            code: "invalid_continuation",
            message: "The continuation must be passed unchanged.",
          };
        }
        if (!handle) {
          return {
            kind: "error" as const,
            index: target.index,
            continuation: target.continuation,
            code: "invalid_continuation",
            message: "The continuation has expired; search or outline again.",
          };
        }
        try {
          const output = await inspect(
            { path: handle.path, nodeId: handle.id, view: "source" },
            cwd,
            handles,
          );
          if (output.startsWith("stale_node:")) {
            return {
              kind: "error" as const,
              index: target.index,
              continuation: target.continuation,
              code: "stale_node",
              message: output,
              next: [outlineRequest(handle.path, undefined)],
            };
          }
          return {
            kind: "source" as const,
            source: {
              continuation: target.continuation,
              path: handle.path,
              type: handle.type,
              source: output,
            },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const code = /^([a-z][a-z0-9_]*):/.exec(message)?.[1] ?? "inspect_failed";
          return {
            kind: "error" as const,
            index: target.index,
            continuation: target.continuation,
            code,
            message,
            next: [outlineRequest(handle.path, undefined)],
          };
        }
      }),
    );
    const sources = inspected.flatMap((target) =>
      target.kind === "source" ? [target.source] : [],
    );
    const errors = inspected.flatMap((target) => (target.kind === "error" ? [target] : []));
    if (sources.length === 0) {
      const allInvalid = errors.every((error) => error.code === "invalid_continuation");
      const allStale = errors.every((error) => error.code === "stale_node");
      const code = allInvalid
        ? "invalid_continuation"
        : allStale
          ? "stale_node"
          : "inspect_many_failed";
      const message = allInvalid
        ? "Every continuation must be valid and unexpired."
        : allStale
          ? (errors[0]?.message ?? "Every target is stale; inspect the current outline again.")
          : "No target could be inspected; use each target error's recovery action and retry.";
      const failed = failure(
        "inspect_many",
        code,
        message,
        errors.flatMap((error) => error.next ?? []),
      );
      return {
        ...failed,
        data: { status: "failed", sources, errors },
      };
    }
    return {
      ok: true,
      action: "inspect_many",
      data: { status: errors.length > 0 ? "partial" : "complete", sources, errors },
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
        "Source inspection requires a selected continuation; request outline first or pass a continuation returned by locate or search.",
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
                  action: "edit" as const,
                  continuation: responseHandles[0].continuation,
                  replacement: "",
                },
              ],
            }
          : {}),
    };
  }

  if (request.action === "rename") {
    if (!isContinuation(request.continuation)) {
      return failure(
        "rename",
        "invalid_continuation",
        "Pass the declaration continuation unchanged.",
      );
    }
    const result = await renameContinuationDetailed(request, cwd, handles, lsp);
    if (!result.message.startsWith("renamed ")) {
      return failure("rename", result.message.split(":")[0] ?? "rename_failed", result.message);
    }
    return {
      ok: true,
      action: "rename",
      message: "ok",
      data: result.details ? { ...result.details } : {},
    };
  }

  if (!isContinuation(request.continuation)) {
    return failure("edit", "invalid_continuation", "Pass the source continuation unchanged.");
  }
  const target = handles.resolveContinuation(request.continuation.token);
  if (!target)
    return failure(
      "edit",
      "invalid_continuation",
      "The continuation has expired; inspect source again.",
    );
  return withFileMutationQueue(resolve(cwd, target.path), async () => {
    const result = await editContinuationDetailed(request, cwd, handles);
    if (!result.message.startsWith("edited ")) {
      return failure("edit", result.message.split(":")[0] ?? "edit_failed", result.message, [
        { action: "inspect", continuation: request.continuation, detail: "source" },
      ]);
    }
    const updated = result.details?.recommendedNextInspectionTarget
      ? handles.get(result.details.recommendedNextInspectionTarget)
      : undefined;
    const nextHandle = updated ? handleResponse(handles, updated) : undefined;
    return {
      ok: true,
      action: "edit",
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
  const lsp = new LspManager();
  pi.on("session_shutdown", async () => {
    await lsp.shutdown();
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
    description: `Use first for existing ${supportedLanguageDescription} source instead of read/edit: resolve edit targets with structural/LSP signals, inspect syntax, batch selected reads, safely replace validated nodes, and use semantic rename when LSP is available. Avoid for new, generated, configuration, or unsupported files.`,
    promptSnippet:
      "Prefer for existing supported source; resolve targets, batch inspections when useful, safely replace validated syntax, and use semantic rename for symbol renames",
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
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("warning", "Processing Astrolabe..."), 0, 0);
      const output = resultText(result);
      let parsed: SyntaxResponse | undefined;
      try {
        parsed = JSON.parse(output) as SyntaxResponse;
      } catch {
        parsed = undefined;
      }
      const response = parsed;
      let summary = response
        ? `${response.action}: ${response.ok ? "ok" : (response.error?.code ?? "failed")}`
        : output || "Astrolabe failed";
      if (response?.data) {
        const data = response.data;
        const candidateCount =
          typeof data.candidateCount === "number" ? `; ${data.candidateCount} candidate(s)` : "";
        const matchCount =
          typeof data.matchCount === "number" ? `; ${data.matchCount} match(es)` : "";
        summary += candidateCount + matchCount;
      }
      if (expanded) summary += `\n\n${output}`;
      return new Text(theme.fg(context.isError ? "error" : "toolOutput", summary), 0, 0);
    },
    async execute(_id, params, _signal, _update, ctx) {
      const start = Date.now();
      const request = params as SyntaxRequest;
      let response: SyntaxResponse;
      try {
        response = await dispatch(request, ctx.cwd, handles, lsp);
      } catch (error) {
        response = failure(request.action, "syntax_error", String(error));
      }
      const text = responseText(response);
      record(metrics, request.action, JSON.stringify(params).length, text, start);
      if (!response.ok) throw new Error(text);
      return {
        content: [{ type: "text", text }],
        details: { metrics },
      };
    },
  });
}
