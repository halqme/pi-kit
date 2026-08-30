import { parseFile } from "../syntax/parser.ts";
import { HandleStore, resolveHandleResult } from "../syntax/node-handles.ts";
import {
  adapterForIdentity,
  adapterForLanguage,
  requireAdapterForPath,
  type LanguageAdapter,
  type LanguageId,
} from "../syntax/language-profile.ts";
import { resolveExistingPath } from "../syntax/path.ts";
import { outline, source, structure } from "../syntax/render.ts";

export type View = "outline" | "structure" | "source";

export interface InspectParams {
  path: string;
  language?: LanguageId;
  nodeId?: string;
  view?: View;
  depth?: number;
}

export async function inspect(
  params: InspectParams,
  cwd: string,
  handles: HandleStore,
): Promise<string> {
  const path = await resolveExistingPath(cwd, params.path);
  const handle = params.nodeId ? handles.get(params.nodeId) : undefined;
  if (params.nodeId && !handle) throw new Error(`Unknown nodeId: ${params.nodeId}`);
  if (handle && handle.path !== path) throw new Error("nodeId belongs to a different path");

  let adapter: LanguageAdapter;
  if (handle) {
    const handleAdapter = adapterForIdentity(handle.languageId, handle.grammarId);
    if (!handleAdapter) {
      return "stale_node: The handle's language or grammar is no longer available. Run syntax_inspect again.";
    }
    if (params.language) {
      const requested = adapterForLanguage(params.language);
      if (requested.id !== handleAdapter.id || requested.grammar.id !== handleAdapter.grammar.id) {
        throw new Error(
          "language_mismatch: language override differs from the inspected node handle.",
        );
      }
    }
    adapter = handleAdapter;
  } else {
    adapter = requireAdapterForPath(path, params.language);
  }

  const view = params.view ?? "outline";
  if (view === "structure" && !handle) {
    throw new Error(
      "structure_requires_node: Start with outline, then drill down with structure on a selected nodeId.",
    );
  }
  const file = await parseFile(path, adapter);
  const resolution = handle
    ? resolveHandleResult(file, handles, handle)
    : { status: "resolved" as const, node: file.tree.rootNode };
  if (resolution.status === "stale") {
    return `stale_node: ${resolution.reason}. Run syntax_inspect again.`;
  }
  const node = resolution.node;
  const depth = Math.max(0, Math.min(params.depth ?? 2, 12));
  if (view === "source") {
    const output = source(file, node);
    if (handle) handles.markSourceInspected(handle.id);
    return output;
  }
  return view === "structure"
    ? structure(file, node, handles, depth)
    : outline(file, node, handles, depth);
}
