import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { Node } from "web-tree-sitter";
import { editDetailed } from "./edit.ts";
import { HandleStore } from "../syntax/node-handles.ts";
import { parseFile, sourceOf } from "../syntax/parser.ts";
import { requireAdapterForPath } from "../syntax/language-profile.ts";
import { resolveExistingPath } from "../syntax/path.ts";

export interface TextEditParams {
  path: string;
  oldText: string;
  newText: string;
}

export interface TextEditResult {
  message: string;
  targetType?: string;
}

function normalizedPath(path: string): string {
  return path.startsWith("@") ? path.slice(1) : path;
}

function smallestContainingNamedNode(root: Node, startIndex: number, endIndex: number): Node {
  let current = root;
  for (;;) {
    const child = current.namedChildren.find(
      (candidate) =>
        candidate !== null &&
        candidate.startIndex <= startIndex &&
        candidate.endIndex >= endIndex,
    );
    if (!child) return current;
    current = child;
  }
}

export async function editTextDetailed(
  params: TextEditParams,
  cwd: string,
  handles: HandleStore,
): Promise<TextEditResult> {
  if (params.oldText.length === 0) {
    return { message: "old_text_required: oldText must be non-empty so the edit has an exact target." };
  }

  const path = await resolveExistingPath(cwd, normalizedPath(params.path));
  return withFileMutationQueue(path, async () => {
    const adapter = requireAdapterForPath(path);
    const file = await parseFile(path, adapter);
    const startIndex = file.source.indexOf(params.oldText);
    if (startIndex < 0) {
      return { message: "old_text_not_found: oldText does not occur in the current file." };
    }
    if (file.source.indexOf(params.oldText, startIndex + params.oldText.length) >= 0) {
      return {
        message: "old_text_not_unique: oldText occurs more than once; provide a larger exact match.",
      };
    }

    const endIndex = startIndex + params.oldText.length;
    const target = smallestContainingNamedNode(file.tree.rootNode, startIndex, endIndex);
    const targetSource = sourceOf(file, target);
    const relativeStart = startIndex - target.startIndex;
    const replacement =
      targetSource.slice(0, relativeStart) +
      params.newText +
      targetSource.slice(relativeStart + params.oldText.length);
    const handle = handles.issue(file, target, "source");
    const result = await editDetailed({ path, nodeId: handle.id, replacement }, cwd, handles);
    return { message: result.message, targetType: target.type };
  });
}
