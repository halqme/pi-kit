import { Query, type Node } from "web-tree-sitter";
import { adapterForIdentity } from "./language-profile.ts";
import { sourceOf, type ParsedFile } from "./parser.ts";
import { HandleStore } from "./node-handles.ts";

interface RenderContext {
  classifications: Map<number, string>;
  labels: Map<number, string>;
  importantNodeTypes: ReadonlySet<string>;
}

function captures(file: ParsedFile, querySource: string): Map<number, string> {
  const result = new Map<number, string>();
  let query: Query | undefined;
  try {
    query = new Query(file.tree.language, querySource);
    for (const capture of query.captures(file.tree.rootNode)) {
      result.set(capture.node.id, capture.name);
    }
  } catch {
    return result;
  } finally {
    query?.delete();
  }
  return result;
}

function labelCaptures(file: ParsedFile, querySource: string): Map<number, string> {
  const result = new Map<number, string>();
  let query: Query | undefined;
  try {
    query = new Query(file.tree.language, querySource);
    for (const capture of query.captures(file.tree.rootNode)) {
      result.set(capture.node.id, sourceOf(file, capture.node).replace(/\s+/g, " "));
    }
  } catch {
    return result;
  } finally {
    query?.delete();
  }
  return result;
}

function contextFor(file: ParsedFile): RenderContext {
  const adapter = adapterForIdentity(file.languageId, file.grammarId);
  if (!adapter) {
    throw new Error(`unsupported_language: No adapter for ${file.languageId} (${file.grammarId}).`);
  }
  return {
    classifications: captures(file, adapter.outlineQuery),
    labels: labelCaptures(file, adapter.labelsQuery),
    importantNodeTypes: adapter.importantNodeTypes,
  };
}

function compact(text: string, limit = 180): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function namedLabel(node: Node, file: ParsedFile, context: RenderContext): string {
  const named = context.labels.has(node.id)
    ? context.labels.get(node.id)
    : node.namedChildren.find(
        (child) =>
          child && ["identifier", "type_identifier", "property_identifier"].includes(child.type),
      );
  return typeof named === "string" ? named : named ? compact(sourceOf(file, named)) : "";
}

function declarationSummary(node: Node, file: ParsedFile, context: RenderContext): string {
  const classification = (context.classifications.get(node.id) ?? node.type).replace(/[_.]/g, " ");
  const name = namedLabel(node, file, context);

  if (
    ["function_declaration", "generator_function_declaration", "method_definition"].includes(
      node.type,
    )
  ) {
    const body = node.childForFieldName("body");
    const signature = compact(
      body
        ? sourceOf(file, node).slice(0, body.startIndex - node.startIndex)
        : sourceOf(file, node),
    ).replace(/\s*[{;]\s*$/, "");
    const nameOffset = name ? signature.indexOf(name) : -1;
    const readableSignature =
      nameOffset >= 0 ? signature.slice(nameOffset + name.length) : signature;
    return `${classification} ${name ? `${name}${readableSignature}` : readableSignature.trim()}`;
  }

  if (node.type === "class_declaration" || node.type === "interface_declaration") {
    const body = node.childForFieldName("body");
    const header = compact(
      body
        ? sourceOf(file, node).slice(0, body.startIndex - node.startIndex)
        : sourceOf(file, node),
    ).replace(/\s*[{;]\s*$/, "");
    const nameOffset = name ? header.indexOf(name) : -1;
    const readableHeader =
      nameOffset >= 0 ? `${name}${header.slice(nameOffset + name.length)}` : header;
    const members = body
      ? body.namedChildren
          .map((member) => member && namedLabel(member, file, context))
          .filter((member): member is string => Boolean(member))
      : [];
    const memberText = members.length > 0 ? `; members: ${members.slice(0, 8).join(", ")}` : "";
    return `${classification} ${readableHeader}${memberText}`;
  }

  if (node.type === "import_statement") {
    return `${classification} ${compact(sourceOf(file, node))}`;
  }

  return `${classification}${name ? ` ${name}` : ""}`;
}

function label(node: Node, file: ParsedFile, context: RenderContext): string {
  return declarationSummary(node, file, context);
}

export function outline(file: ParsedFile, node: Node, handles: HandleStore, depth: number): string {
  const context = contextFor(file);
  const lines: string[] = [];
  const visit = (current: Node, level: number): void => {
    if (level > depth) return;
    const classification = context.classifications.get(current.id);
    if (current !== node && !classification && !context.importantNodeTypes.has(current.type)) {
      for (const child of current.namedChildren) if (child) visit(child, level);
      return;
    }
    const handle = handles.issue(file, current, "outline");
    lines.push(`${"  ".repeat(level)}node=${handle.id} ${label(current, file, context)}`);
    for (const child of current.namedChildren) if (child) visit(child, level + 1);
  };
  for (const child of node.namedChildren) if (child) visit(child, 0);
  return lines.join("\n") || "(no structural declarations)";
}

export function structure(
  file: ParsedFile,
  node: Node,
  handles: HandleStore,
  depth: number,
): string {
  const context = contextFor(file);
  const lines: string[] = [];
  const visit = (current: Node, level: number): void => {
    if (level > depth) return;
    const handle = handles.issue(file, current, "structure");
    lines.push(`${"  ".repeat(level)}nodeId=${handle.id} ${label(current, file, context)}`);
    for (const child of current.namedChildren) if (child) visit(child, level + 1);
  };
  visit(node, 0);
  return lines.join("\n");
}

export function source(file: ParsedFile, node: Node): string {
  return sourceOf(file, node);
}
