import { randomUUID } from "node:crypto";
import { chmod, rename, stat, unlink, writeFile } from "node:fs/promises";
import { HandleStore, resolveHandleResult } from "./node-handles.ts";
import type { Continuation } from "./protocol.ts";
import {
  cacheFile,
  createTreeEdit,
  parseFile,
  parseSource,
  sourceRange,
  withParserActivity,
} from "./parser.ts";
import { adapterForIdentity } from "./language-profile.ts";
import { resolveExistingPath } from "./path.ts";
import {
  describeSyntaxIssues,
  findNewSyntaxIssues,
  validateReplacementNode,
} from "./syntax-validation.ts";

export interface EditParams {
  path: string;
  nodeId: string;
  replacement: string;
}

export interface ContinuationEditParams {
  continuation: Continuation;
  replacement: string;
}

export interface EditDetails {
  editedNode: { id: string; type: string };
  newSyntaxErrorCount: number;
  invalidatedHandles: string[];
  updatedParentHandle?: string;
  recommendedNextInspectionTarget: string;
}

export interface EditResult {
  message: string;
  details?: EditDetails;
}

function failed(message: string): EditResult {
  return { message };
}

async function editImpl(
  params: EditParams,
  cwd: string,
  handles: HandleStore,
): Promise<EditResult> {
  const path = await resolveExistingPath(cwd, params.path);
  const originalMode = (await stat(path)).mode & 0o7777;
  const old = handles.get(params.nodeId);
  if (!old) throw new Error(`Unknown nodeId: ${params.nodeId}`);
  if (old.path !== path) throw new Error("nodeId belongs to a different path");
  const adapter = adapterForIdentity(old.languageId, old.grammarId);
  if (!adapter) {
    return failed(
      "stale_node: The handle's language or grammar is no longer available. Run syntax_inspect again.",
    );
  }
  const file = await parseFile(path, adapter);
  const resolution = resolveHandleResult(file, handles, old);
  if (resolution.status === "stale") {
    return failed(`stale_node: ${resolution.reason}. Run syntax_inspect again.`);
  }
  const node = resolution.node;

  const startIndex = node.startIndex;
  const endIndex = node.endIndex;
  const treeEdit = createTreeEdit(file.source, startIndex, endIndex, params.replacement);
  const nextSource =
    sourceRange(file.source, 0, startIndex) +
    params.replacement +
    sourceRange(file.source, endIndex, file.source.length);
  const checked = await parseSource(path, nextSource, {
    adapter,
    previous: { file, edit: treeEdit },
  });
  const newIssues = findNewSyntaxIssues(file, checked, treeEdit);
  if (newIssues.length > 0) {
    checked.tree.delete();
    return failed(describeSyntaxIssues(newIssues));
  }
  const structuralError = validateReplacementNode(node, checked.tree, treeEdit, params.replacement);
  if (structuralError) {
    checked.tree.delete();
    return failed(structuralError);
  }

  const tmp = `${path}.${randomUUID()}.tmp`;
  let renamed = false;
  try {
    await writeFile(tmp, nextSource, "utf8");
    await chmod(tmp, originalMode);
    await rename(tmp, path);
    renamed = true;
    cacheFile(checked);
  } finally {
    if (!renamed) {
      checked.tree.delete();
      await unlink(tmp).catch(() => undefined);
    }
  }
  const invalidatedHandles = handles
    .list(path)
    .filter(
      (handle) =>
        handle.id !== old.id && handle.startIndex < endIndex && handle.endIndex > startIndex,
    )
    .map((handle) => handle.id);
  for (const id of invalidatedHandles) handles.delete(id);

  const replacementNode = checked.tree.rootNode.descendantForIndex(
    startIndex,
    startIndex + params.replacement.length,
  );
  const parent = replacementNode?.parent;
  const updatedParentHandle = parent ? handles.issue(checked, parent, "structure").id : undefined;
  const message =
    `edited ${params.path}: ${old.type} with ${file.languageId}` +
    (params.replacement === "" ? " (deleted)" : "") +
    "; re-inspect before further edits";
  return {
    message,
    details: {
      editedNode: { id: old.id, type: old.type },
      newSyntaxErrorCount: 0,
      invalidatedHandles,
      ...(updatedParentHandle ? { updatedParentHandle } : {}),
      recommendedNextInspectionTarget: updatedParentHandle ?? old.id,
    },
  };
}

export function editDetailed(
  params: EditParams,
  cwd: string,
  handles: HandleStore,
): Promise<EditResult> {
  return withParserActivity(() => editImpl(params, cwd, handles));
}

export function editContinuationDetailed(
  params: ContinuationEditParams,
  cwd: string,
  handles: HandleStore,
): Promise<EditResult> {
  const handle = handles.resolveContinuation(params.continuation.token);
  if (!handle)
    return Promise.resolve(failed("invalid_continuation: The continuation has expired."));
  return editDetailed(
    { path: handle.path, nodeId: handle.id, replacement: params.replacement },
    cwd,
    handles,
  );
}

export async function edit(params: EditParams, cwd: string, handles: HandleStore): Promise<string> {
  return (await editDetailed(params, cwd, handles)).message;
}
