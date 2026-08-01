import { randomUUID } from "node:crypto";
import type { Node } from "web-tree-sitter";
import { hash, sourceOf, stringIndexToByteIndex, type ParsedFile } from "./parser.ts";
import { adapterForIdentity } from "./language-profile.ts";

export type InspectionStage = "outline" | "structure" | "source";

function isDeclaration(file: ParsedFile, node: Node): boolean {
  const adapter = adapterForIdentity(file.languageId, file.grammarId);
  return adapter?.declarationNodeTypes.has(node.type) ?? false;
}

function declarationName(file: ParsedFile, node: Node): string | undefined {
  const name = node.childForFieldName("name");
  return name ? sourceOf(file, name).trim() : undefined;
}

function sameContext(file: ParsedFile, node: Node, old: NodeHandle): number {
  const before = file.source.slice(
    Math.max(0, node.startIndex - old.contextBefore.length),
    node.startIndex,
  );
  const after = file.source.slice(node.endIndex, node.endIndex + old.contextAfter.length);
  return (before === old.contextBefore ? 1 : 0) + (after === old.contextAfter ? 1 : 0);
}

function candidateScore(file: ParsedFile, node: Node, old: NodeHandle): number {
  const parent = node.parent;
  const siblings = parent?.children ?? [];
  const index = parent ? siblings.findIndex((child) => child?.id === node.id) : -1;
  let score = 0;
  if (parent?.type === old.parentType) score += 4;
  if (old.parentDeclarationName && parentDeclarationName(file, node) === old.parentDeclarationName)
    score += 8;
  if (old.ancestorTypes.join("/") === ancestorTypes(node).join("/")) score += 5;
  if (index >= 0 && parent?.fieldNameForChild(index) === old.fieldName) score += 3;
  if (index > 0 && siblings[index - 1]?.type === old.previousSiblingType) score += 2;
  if (
    index >= 0 &&
    index + 1 < siblings.length &&
    siblings[index + 1]?.type === old.nextSiblingType
  )
    score += 2;
  score += sameContext(file, node, old);
  return score;
}

function ancestorTypes(node: Node): string[] {
  const types: string[] = [];
  let current = node.parent;
  while (current) {
    types.push(current.type);
    current = current.parent;
  }
  return types;
}

function parentDeclarationName(file: ParsedFile, node: Node): string | undefined {
  let current = node.parent;
  while (current) {
    if (isDeclaration(file, current)) return declarationName(file, current);
    current = current.parent;
  }
  return undefined;
}

export interface NodeHandle {
  id: string;
  path: string;
  languageId: string;
  grammarId: string;
  inspectionStage: InspectionStage;
  treeVersion: string;
  type: string;
  startIndex: number;
  endIndex: number;
  startByte: number;
  endByte: number;
  startPosition: Node["startPosition"];
  endPosition: Node["endPosition"];
  sourceHash: string;
  parentType?: string;
  parentDeclarationName?: string;
  ancestorTypes: string[];
  fieldName?: string;
  previousSiblingType?: string;
  nextSiblingType?: string;
  contextBefore: string;
  contextAfter: string;
}

export class HandleStore {
  private next = 1;
  private readonly handles = new Map<string, NodeHandle>();
  private readonly handlesByPath = new Map<string, Set<string>>();
  private readonly continuations = new Map<string, string>();
  private readonly continuationByHandle = new Map<string, Set<string>>();
  private readonly maxHandlesPerFile: number;

  constructor(maxHandlesPerFile = 256) {
    if (!Number.isInteger(maxHandlesPerFile) || maxHandlesPerFile < 1) {
      throw new RangeError("maxHandlesPerFile must be a positive integer");
    }
    this.maxHandlesPerFile = maxHandlesPerFile;
  }

  issue(file: ParsedFile, node: Node, inspectionStage: InspectionStage = "structure"): NodeHandle {
    const parent = node.parent;
    const siblings = parent?.children ?? [];
    const siblingIndex = parent ? siblings.findIndex((child) => child?.id === node.id) : -1;
    const ancestors: string[] = [];
    let ancestor = parent;
    let parentDeclarationName: string | undefined;
    while (ancestor) {
      ancestors.push(ancestor.type);
      if (!parentDeclarationName && isDeclaration(file, ancestor)) {
        parentDeclarationName = declarationName(file, ancestor);
      }
      ancestor = ancestor.parent;
    }
    const fieldName = parent && siblingIndex >= 0 ? parent.fieldNameForChild(siblingIndex) : null;
    const previousSibling = siblingIndex > 0 ? siblings[siblingIndex - 1] : null;
    const nextSibling = siblingIndex >= 0 ? siblings[siblingIndex + 1] : null;
    const contextSize = 32;
    const handle: NodeHandle = {
      id: `n${this.next++}`,
      path: file.path,
      languageId: file.languageId,
      grammarId: file.grammarId,
      inspectionStage,
      treeVersion: file.hash,
      type: node.type,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
      startByte: stringIndexToByteIndex(file.source, node.startIndex),
      endByte: stringIndexToByteIndex(file.source, node.endIndex),
      startPosition: node.startPosition,
      endPosition: node.endPosition,
      sourceHash: hash(sourceOf(file, node)),
      ancestorTypes: ancestors,
      contextBefore: file.source.slice(Math.max(0, node.startIndex - contextSize), node.startIndex),
      contextAfter: file.source.slice(node.endIndex, node.endIndex + contextSize),
      ...(parent ? { parentType: parent.type } : {}),
      ...(parentDeclarationName ? { parentDeclarationName } : {}),
      ...(fieldName ? { fieldName } : {}),
      ...(previousSibling ? { previousSiblingType: previousSibling.type } : {}),
      ...(nextSibling ? { nextSiblingType: nextSibling.type } : {}),
    };
    this.handles.set(handle.id, handle);
    const fileHandles = this.handlesByPath.get(file.path) ?? new Set<string>();
    fileHandles.add(handle.id);
    this.handlesByPath.set(file.path, fileHandles);
    this.evictOldest(file.path, fileHandles);
    return handle;
  }

  get(id: string): NodeHandle | undefined {
    const handle = this.handles.get(id);
    if (!handle) return undefined;
    const fileHandles = this.handlesByPath.get(handle.path);
    if (fileHandles) {
      fileHandles.delete(id);
      fileHandles.add(id);
    }
    return handle;
  }

  markSourceInspected(id: string): NodeHandle | undefined {
    const handle = this.get(id);
    if (handle) handle.inspectionStage = "source";
    return handle;
  }

  issueContinuation(id: string): string | undefined {
    if (!this.get(id)) return undefined;
    const token = randomUUID();
    this.continuations.set(token, id);
    const tokens = this.continuationByHandle.get(id) ?? new Set<string>();
    tokens.add(token);
    this.continuationByHandle.set(id, tokens);
    return token;
  }

  resolveContinuation(token: string): NodeHandle | undefined {
    const id = this.continuations.get(token);
    return id ? this.get(id) : undefined;
  }

  private deleteContinuations(id: string): void {
    for (const token of this.continuationByHandle.get(id) ?? []) this.continuations.delete(token);
    this.continuationByHandle.delete(id);
  }

  size(path?: string): number {
    if (path) return this.handlesByPath.get(path)?.size ?? 0;
    return this.handles.size;
  }

  list(path: string): NodeHandle[] {
    return [...(this.handlesByPath.get(path) ?? [])]
      .map((id) => this.handles.get(id))
      .filter((handle): handle is NodeHandle => handle !== undefined);
  }

  delete(id: string): boolean {
    const handle = this.handles.get(id);
    if (!handle) return false;
    this.handles.delete(id);
    this.deleteContinuations(id);
    const fileHandles = this.handlesByPath.get(handle.path);
    fileHandles?.delete(id);
    if (fileHandles?.size === 0) this.handlesByPath.delete(handle.path);
    return true;
  }

  clear(path?: string): void {
    if (path) {
      for (const id of this.handlesByPath.get(path) ?? []) {
        this.handles.delete(id);
        this.deleteContinuations(id);
      }
      this.handlesByPath.delete(path);
      return;
    }
    this.handles.clear();
    this.handlesByPath.clear();
    this.continuations.clear();
    this.continuationByHandle.clear();
  }

  findReplacement(file: ParsedFile, old: NodeHandle): Node | undefined {
    if (file.languageId !== old.languageId || file.grammarId !== old.grammarId) return undefined;
    const candidates: Node[] = [];
    const visit = (node: Node): void => {
      if (node.type === old.type && hash(sourceOf(file, node)) === old.sourceHash) {
        candidates.push(node);
      }
      for (const child of node.children) if (child) visit(child);
    };
    visit(file.tree.rootNode);
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];
    if (!old.parentDeclarationName) return undefined;
    const scored = candidates
      .map((node) => ({ node, score: candidateScore(file, node, old) }))
      .sort((left, right) => right.score - left.score);
    if (scored.length < 2 || scored[0]?.score !== scored[1]?.score) return scored[0]?.node;
    return undefined;
  }

  private evictOldest(path: string, fileHandles: Set<string>): void {
    while (fileHandles.size > this.maxHandlesPerFile) {
      const oldest = fileHandles.values().next().value;
      if (!oldest) break;
      fileHandles.delete(oldest);
      this.handles.delete(oldest);
      this.deleteContinuations(oldest);
    }
    if (fileHandles.size === 0) this.handlesByPath.delete(path);
  }
}

export type HandleResolution =
  | { status: "resolved"; node: Node }
  | { status: "stale"; reason: string };

export function resolveHandleResult(
  file: ParsedFile,
  handles: HandleStore,
  old: NodeHandle,
): HandleResolution {
  if (file.languageId !== old.languageId || file.grammarId !== old.grammarId) {
    return { status: "stale", reason: "language_or_grammar_mismatch" };
  }
  const candidate =
    file.hash === old.treeVersion
      ? file.tree.rootNode.descendantForIndex(old.startIndex, old.endIndex)
      : handles.findReplacement(file, old);
  if (!candidate) return { status: "stale", reason: "not_unique" };
  if (candidate.type !== old.type) return { status: "stale", reason: "type_mismatch" };
  if (hash(sourceOf(file, candidate)) !== old.sourceHash) {
    return { status: "stale", reason: "source_mismatch" };
  }
  if (old.parentType !== undefined && candidate.parent?.type !== old.parentType) {
    return { status: "stale", reason: "parent_mismatch" };
  }
  return { status: "resolved", node: candidate };
}

export function resolveHandle(
  file: ParsedFile,
  handles: HandleStore,
  old: NodeHandle,
): Node | undefined {
  const result = resolveHandleResult(file, handles, old);
  return result.status === "resolved" ? result.node : undefined;
}
