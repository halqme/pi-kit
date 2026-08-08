import type { Node } from "web-tree-sitter";
import { adapterForIdentity } from "./language-profile.ts";
import { LspError, type LspService } from "./lsp.ts";
import { HandleStore, resolveHandleResult } from "./node-handles.ts";
import { parseFile } from "./parser.ts";
import type { RenameRequest } from "./protocol.ts";
import {
  applyWorkspaceEdit,
  WorkspaceMutationError,
  type WorkspaceMutationDetails,
} from "./workspace-edit.ts";

export interface RenameResult {
  message: string;
  details?: WorkspaceMutationDetails;
}

function renamePosition(node: Node): { line: number; character: number } | undefined {
  const direct = node.childForFieldName("name");
  if (direct) return { line: direct.startPosition.row, character: direct.startPosition.column };
  for (const child of node.namedChildren) {
    if (!child) continue;
    const nested = child.childForFieldName("name");
    if (nested) return { line: nested.startPosition.row, character: nested.startPosition.column };
  }
  return undefined;
}

export async function renameContinuationDetailed(
  params: RenameRequest,
  cwd: string,
  handles: HandleStore,
  lsp: LspService,
): Promise<RenameResult> {
  if (!params.newName.trim()) return { message: "invalid_rename: newName must not be empty." };
  const handle = handles.resolveContinuation(params.continuation.token);
  if (!handle) return { message: "invalid_continuation: The continuation has expired." };
  const adapter = adapterForIdentity(handle.languageId, handle.grammarId);
  if (!adapter) {
    return { message: "stale_node: The handle's language or grammar is no longer available." };
  }
  if (!adapter.lsp) {
    return { message: `lsp_unavailable: No LSP server is configured for ${adapter.id}.` };
  }
  const file = await parseFile(handle.path, adapter);
  const resolution = resolveHandleResult(file, handles, handle);
  if (resolution.status === "stale") {
    return { message: `stale_node: ${resolution.reason}. Re-locate the symbol before renaming.` };
  }
  const position = renamePosition(resolution.node);
  if (!position) {
    return {
      message: `rename_unavailable: ${resolution.node.type} has no discoverable declaration name position.`,
    };
  }

  try {
    const workspaceEdit = await lsp.rename(adapter, cwd, handle.path, position, params.newName);
    const details = await applyWorkspaceEdit(workspaceEdit, cwd, handles);
    return {
      message: `renamed symbol to ${params.newName} across ${details.files} file(s) with ${details.edits} edit(s)`,
      details,
    };
  } catch (error) {
    if (error instanceof LspError || error instanceof WorkspaceMutationError) {
      return { message: `${error.code}: ${error.message}` };
    }
    return { message: `rename_failed: ${String(error)}` };
  }
}
