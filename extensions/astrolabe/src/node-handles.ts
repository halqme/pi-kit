import type { Node } from "web-tree-sitter";
import { hash, lineHash, stringIndexToByteIndex, type ParsedFile, sourceOf } from "./parser.ts";

export interface NodeHandle { id: string; path: string; treeVersion: string; type: string; startIndex: number; endIndex: number; startByte: number; endByte: number; startPosition: Node["startPosition"]; endPosition: Node["endPosition"]; sourceHash: string; startLineHash: string; }

export class HandleStore {
  private next = 1;
  private readonly handles = new Map<string, NodeHandle>();
  issue(file: ParsedFile, node: Node): NodeHandle { const handle: NodeHandle = { id: `n${this.next++}`, path: file.path, treeVersion: file.hash, type: node.type, startIndex: node.startIndex, endIndex: node.endIndex, startByte: stringIndexToByteIndex(file.source, node.startIndex), endByte: stringIndexToByteIndex(file.source, node.endIndex), startPosition: node.startPosition, endPosition: node.endPosition, sourceHash: hash(sourceOf(file, node)), startLineHash: lineHash(file.source, node.startPosition.row) }; this.handles.set(handle.id, handle); return handle; }
  get(id: string): NodeHandle | undefined { return this.handles.get(id); }
  findReplacement(file: ParsedFile, old: NodeHandle): Node | undefined {
    const candidates: Node[] = [];
    const visit = (node: Node) => { if (node.type === old.type && hash(sourceOf(file, node)) === old.sourceHash && lineHash(file.source, node.startPosition.row) === old.startLineHash) candidates.push(node); for (const child of node.namedChildren) if (child) visit(child); };
    visit(file.tree.rootNode);
    const near = candidates.filter((node) => Math.abs(node.startPosition.row - old.startPosition.row) <= 20);
    const selected = near.length === 1 ? near : candidates;
    return selected.length === 1 ? selected[0] : undefined;
  }
}
