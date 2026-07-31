import { resolve, relative } from "node:path";
import { parseFile } from "./parser.ts";
import { HandleStore } from "./node-handles.ts";
import { outline, source, structure } from "./render.ts";
export type View = "outline" | "structure" | "source";
export interface InspectParams {
  path: string;
  nodeId?: string;
  view?: View;
  depth?: number;
}
export async function inspect(
  params: InspectParams,
  cwd: string,
  handles: HandleStore,
): Promise<string> {
  const path = resolve(cwd, params.path);
  if (relative(cwd, path).startsWith(".."))
    throw new Error("path must stay within the working directory");
  const file = await parseFile(path);
  const handle = params.nodeId ? handles.get(params.nodeId) : undefined;
  if (params.nodeId && !handle) throw new Error(`Unknown nodeId: ${params.nodeId}`);
  if (handle && handle.path !== path) throw new Error("nodeId belongs to a different path");
  const node = handle
    ? file.tree.rootNode.descendantForIndex(handle.startIndex, handle.endIndex)
    : file.tree.rootNode;
  if (!node) throw new Error("Node range is invalid; inspect the file again");
  const depth = Math.max(0, Math.min(params.depth ?? 3, 12));
  const view = params.view ?? "outline";
  return view === "source"
    ? source(file, node)
    : view === "structure"
      ? structure(file, node, handles, depth)
      : outline(file, node, handles, depth);
}
