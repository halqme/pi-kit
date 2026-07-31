import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { cacheFile, hash, parseFile, parseSource, sourceRange } from "./parser.ts";
import { HandleStore } from "./node-handles.ts";
export async function edit(
  params: { path: string; nodeId: string; replacement: string },
  cwd: string,
  handles: HandleStore,
): Promise<string> {
  const path = resolve(cwd, params.path);
  if (relative(cwd, path).startsWith(".."))
    throw new Error("path must stay within the working directory");
  const old = handles.get(params.nodeId);
  if (!old) throw new Error(`Unknown nodeId: ${params.nodeId}`);
  if (old.path !== path) throw new Error("nodeId belongs to a different path");
  const file = await parseFile(path);
  let node =
    file.hash === old.treeVersion
      ? file.tree.rootNode.descendantForIndex(old.startIndex, old.endIndex)
      : handles.findReplacement(file, old);
  if (!node)
    return "stale_node: The node could not be uniquely located. Run syntax_inspect again.";
  if (hash(sourceRange(file.source, node.startIndex, node.endIndex)) !== old.sourceHash)
    return "stale_node: The node content has changed. Run syntax_inspect again.";
  const start = node.startIndex;
  const end = node.endIndex;
  const nextSource = file.source.slice(0, start) + params.replacement + file.source.slice(end);
  const checked = await parseSource(path, nextSource, { tree: file.tree });
  cacheFile(checked);
  if (checked.syntaxErrors > file.syntaxErrors)
    return "syntax_error: replacement increases syntax errors; file was not changed.";
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, nextSource, "utf8");
  await rename(tmp, path);
  return (
    `edited ${params.path} [${node.startIndex}:${node.endIndex}]` +
    (params.replacement === "" ? " (deleted)" : "")
  );
}
