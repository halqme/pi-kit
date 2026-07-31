import type { Node, Tree } from "web-tree-sitter";
import { syntaxIssues, type ParsedFile, type SyntaxIssue, type TreeEdit } from "./parser.ts";

function mapIndex(index: number, edit: TreeEdit): number | undefined {
  if (index <= edit.startIndex) return index;
  if (index >= edit.oldEndIndex) {
    return edit.newEndIndex + index - edit.oldEndIndex;
  }
  return undefined;
}

function sameIssue(left: SyntaxIssue, right: SyntaxIssue): boolean {
  return (
    left.kind === right.kind &&
    left.type === right.type &&
    left.startIndex === right.startIndex &&
    left.endIndex === right.endIndex
  );
}

/** Return syntax issues in the new tree that cannot be explained by old issues. */
export function findNewSyntaxIssues(
  before: ParsedFile,
  after: ParsedFile,
  edit: TreeEdit,
): SyntaxIssue[] {
  const expected: SyntaxIssue[] = [];
  for (const issue of before.syntaxIssues) {
    const overlapsEditedSource =
      issue.startIndex < edit.oldEndIndex && issue.endIndex > edit.startIndex;
    if (overlapsEditedSource) continue;
    const start = mapIndex(issue.startIndex, edit);
    const end = mapIndex(issue.endIndex, edit);
    if (start !== undefined && end !== undefined) {
      expected.push({ ...issue, startIndex: start, endIndex: end });
    }
  }

  const unmatched = [...after.syntaxIssues];
  for (const issue of expected) {
    const index = unmatched.findIndex((candidate) => sameIssue(issue, candidate));
    if (index >= 0) unmatched.splice(index, 1);
  }
  return unmatched;
}

function nodesWithRange(tree: Tree, startIndex: number, endIndex: number): Node[] {
  const matches: Node[] = [];
  const visit = (node: Node): void => {
    if (node.startIndex === startIndex && node.endIndex === endIndex) matches.push(node);
    for (const child of node.children) if (child) visit(child);
  };
  visit(tree.rootNode);
  return matches;
}

function nodesWithinRange(tree: Tree, startIndex: number, endIndex: number): Node[] {
  const matches: Node[] = [];
  const visit = (node: Node): void => {
    if (node.startIndex >= startIndex && node.endIndex <= endIndex) matches.push(node);
    for (const child of node.children) if (child) visit(child);
  };
  visit(tree.rootNode);
  return matches;
}

function isExpression(node: Node): boolean {
  return new Set([
    "array",
    "arrow_function",
    "assignment_expression",
    "augmented_assignment_expression",
    "await_expression",
    "binary_expression",
    "call_expression",
    "conditional_expression",
    "false",
    "function_expression",
    "generator_function",
    "identifier",
    "member_expression",
    "new_expression",
    "null",
    "number",
    "object",
    "parenthesized_expression",
    "regex",
    "string",
    "template_string",
    "this",
    "true",
    "unary_expression",
    "update_expression",
  ]).has(node.type);
}

function compatibleNodeTypes(beforeNode: Node, afterNode: Node): boolean {
  return (
    beforeNode.type === afterNode.type || (isExpression(beforeNode) && isExpression(afterNode))
  );
}

function nodeAtReplacement(
  beforeNode: Node,
  tree: Tree,
  startIndex: number,
  endIndex: number,
): Node | undefined {
  const exact = nodesWithRange(tree, startIndex, endIndex).find((node) =>
    compatibleNodeTypes(beforeNode, node),
  );
  if (exact) return exact;
  const parentType = beforeNode.parent?.type;
  const compatible = nodesWithinRange(tree, startIndex, endIndex).filter(
    (node) =>
      compatibleNodeTypes(beforeNode, node) &&
      (parentType === undefined || node.parent?.type === parentType),
  );
  const startsAtReplacement = compatible.filter((node) => node.startIndex === startIndex);
  if (startsAtReplacement.length === 1) return startsAtReplacement[0];
  return compatible.length === 1 ? compatible[0] : undefined;
}

/** Validate the replacement's structural context after parsing the new source. */
export function validateReplacementNode(
  beforeNode: Node,
  afterTree: Tree,
  edit: TreeEdit,
  replacement: string,
): string | undefined {
  if (replacement.length === 0) return undefined;
  const replacementNode = nodeAtReplacement(
    beforeNode,
    afterTree,
    edit.startIndex,
    edit.newEndIndex,
  );
  if (!replacementNode) {
    const actual = afterTree.rootNode.descendantForIndex(edit.startIndex, edit.newEndIndex);
    return (
      `syntax_error: replacement changes node type from ${beforeNode.type} ` +
      `to ${actual?.type ?? "<none>"}; file was not changed.`
    );
  }
  if (!compatibleNodeTypes(beforeNode, replacementNode)) {
    return (
      `syntax_error: replacement changes node type from ${beforeNode.type} ` +
      `to ${replacementNode.type}; file was not changed.`
    );
  }
  const beforeParentType = beforeNode.parent?.type;
  if (beforeParentType !== undefined && replacementNode.parent?.type !== beforeParentType) {
    return (
      `syntax_error: replacement changes parent context from ${beforeParentType} ` +
      `to ${replacementNode.parent?.type ?? "<none>"}; file was not changed.`
    );
  }
  return undefined;
}

export function describeSyntaxIssues(issues: SyntaxIssue[]): string {
  const locations = issues
    .slice(0, 5)
    .map(
      (issue) =>
        `${issue.kind.toLowerCase()}@${issue.startPosition.row}:${issue.startPosition.column}`,
    )
    .join(", ");
  const suffix = issues.length > 5 ? ", …" : "";
  return `syntax_error: replacement introduces ${issues.length} new syntax issue(s)${locations ? ` (${locations}${suffix})` : ""}; file was not changed.`;
}

export function collectSyntaxIssuesForTree(tree: Tree): SyntaxIssue[] {
  return syntaxIssues(tree);
}
