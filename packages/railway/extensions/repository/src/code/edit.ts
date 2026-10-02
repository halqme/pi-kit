import { randomUUID } from "node:crypto";
import { chmod, rename, stat, unlink, writeFile } from "node:fs/promises";
import type { Node } from "web-tree-sitter";
import { HandleStore, resolveHandleResult, type NodeHandle } from "../syntax/node-handles.ts";
import type { Continuation } from "../syntax/protocol.ts";
import {
  cacheFile,
  createTreeEdit,
  parseFile,
  parseSource,
  sourceRange,
  withParserActivity,
} from "../syntax/parser.ts";
import { adapterForIdentity } from "../syntax/language-profile.ts";
import { resolveExistingPath } from "../syntax/path.ts";
import {
  describeSyntaxIssues,
  findNewSyntaxIssues,
  findNewSyntaxIssuesForEdits,
  validateReplacementNode,
} from "../syntax/syntax-validation.ts";

export interface EditParams {
  path: string;
  nodeId: string;
  replacement: string;
}

export interface ContinuationEditParams {
  continuation: Continuation;
  replacement: string;
}

export type ContinuationEditTarget = ContinuationEditParams;

export interface EditDetails {
  editedNode: { id: string; type: string };
  editedNodes?: Array<{ id: string; type: string }>;
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
    .filter((handle) => handle.startIndex < endIndex && handle.endIndex > startIndex)
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

export async function editManyContinuationDetailed(
  params: { targets: readonly ContinuationEditTarget[] },
  cwd: string,
  handles: HandleStore,
): Promise<EditResult> {
  return withParserActivity(async () => {
    if (params.targets.length === 0) return failed("replace_many requires at least one target.");

    const firstHandle = handles.resolveContinuation(params.targets[0]?.continuation.token ?? "");
    if (!firstHandle) return failed("invalid_continuation: The continuation has expired.");
    const path = firstHandle.path;
    const adapter = adapterForIdentity(firstHandle.languageId, firstHandle.grammarId);
    if (!adapter) {
      return failed(
        "stale_node: The handle's language or grammar is no longer available. Run syntax_search again.",
      );
    }

    const file = await parseFile(path, adapter);
    const targets: Array<{
      handle: NodeHandle;
      node: Node;
      replacement: string;
      startIndex: number;
      endIndex: number;
    }> = [];
    for (const target of params.targets) {
      const handle = handles.resolveContinuation(target.continuation.token);
      if (!handle) return failed("invalid_continuation: The continuation has expired.");
      if (handle.path !== path) {
        return failed("replace_many requires all targets to belong to the same file.");
      }
      if (
        handle.languageId !== firstHandle.languageId ||
        handle.grammarId !== firstHandle.grammarId
      ) {
        return failed("replace_many requires all targets to use the same language and grammar.");
      }
      const resolution = resolveHandleResult(file, handles, handle);
      if (resolution.status === "stale") {
        return failed(`stale_node: ${resolution.reason}. File was not changed.`);
      }
      targets.push({
        handle,
        node: resolution.node,
        replacement: target.replacement,
        startIndex: resolution.node.startIndex,
        endIndex: resolution.node.endIndex,
      });
    }

    targets.sort((left, right) => left.startIndex - right.startIndex);
    for (let index = 1; index < targets.length; index++) {
      const previous = targets[index - 1];
      const current = targets[index];
      if (!previous || !current) continue;
      if (current.startIndex < previous.endIndex) {
        return failed("replace_many does not allow overlapping targets. File was not changed.");
      }
    }
    if (new Set(targets.map((target) => target.handle.id)).size !== targets.length) {
      return failed("replace_many does not allow duplicate targets. File was not changed.");
    }

    let nextSource = file.source;
    for (const target of [...targets].reverse()) {
      nextSource =
        nextSource.slice(0, target.startIndex) +
        target.replacement +
        nextSource.slice(target.endIndex);
    }

    const checked = await parseSource(path, nextSource, { adapter });
    const treeEdits = targets.map((target) =>
      createTreeEdit(file.source, target.startIndex, target.endIndex, target.replacement),
    );
    const newIssues = findNewSyntaxIssuesForEdits(file, checked, treeEdits);
    if (newIssues.length > 0) {
      checked.tree.delete();
      return failed(describeSyntaxIssues(newIssues));
    }

    let offset = 0;
    for (const target of targets) {
      const newStartIndex = target.startIndex + offset;
      const validationEdit = createTreeEdit(
        nextSource,
        newStartIndex,
        newStartIndex,
        target.replacement,
      );
      const structuralError = validateReplacementNode(
        target.node,
        checked.tree,
        validationEdit,
        target.replacement,
      );
      if (structuralError) {
        checked.tree.delete();
        return failed(structuralError);
      }
      offset += target.replacement.length - (target.endIndex - target.startIndex);
    }

    const originalMode = (await stat(path)).mode & 0o7777;
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
      .filter((handle) =>
        targets.some(
          (target) => handle.startIndex < target.endIndex && handle.endIndex > target.startIndex,
        ),
      )
      .map((handle) => handle.id);
    for (const id of invalidatedHandles) handles.delete(id);

    const firstTarget = targets[0];
    const firstNewStart = firstTarget?.startIndex ?? 0;
    const firstNewEnd = firstNewStart + (firstTarget?.replacement.length ?? 0);
    const replacementNode = checked.tree.rootNode.descendantForIndex(firstNewStart, firstNewEnd);
    const parent = replacementNode?.parent;
    const updatedParentHandle = parent ? handles.issue(checked, parent, "structure").id : undefined;
    return {
      message: `edited ${path}: ${targets.length} nodes with ${file.languageId}; re-inspect before further edits`,
      details: {
        editedNode: { id: firstTarget?.handle.id ?? "", type: firstTarget?.node.type ?? "" },
        editedNodes: targets.map((target) => ({ id: target.handle.id, type: target.node.type })),
        newSyntaxErrorCount: 0,
        invalidatedHandles,
        ...(updatedParentHandle ? { updatedParentHandle } : {}),
        recommendedNextInspectionTarget: updatedParentHandle ?? firstTarget?.handle.id ?? "",
      },
    };
  });
}

export async function edit(params: EditParams, cwd: string, handles: HandleStore): Promise<string> {
  return (await editDetailed(params, cwd, handles)).message;
}
