export interface AccessibilityValue {
  value?: unknown;
}

export interface AccessibilityProperty {
  name?: string;
  value?: AccessibilityValue;
}

export interface AccessibilityNode {
  nodeId: string;
  ignored: boolean;
  role?: AccessibilityValue;
  name?: AccessibilityValue;
  value?: AccessibilityValue;
  properties?: AccessibilityProperty[];
  parentId?: string;
  backendDOMNodeId?: number;
}

const STATE_PROPERTIES = new Set([
  "checked",
  "disabled",
  "expanded",
  "focused",
  "invalid",
  "pressed",
  "readonly",
  "required",
  "selected",
]);

const NON_ELEMENT_ROLES = new Set(["inlinetextbox", "linebreak", "rootwebarea", "statictext"]);

function scalar(value: AccessibilityValue | undefined): string {
  const raw = value?.value;
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

function compactText(value: string, limit = 160): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function stateTokens(node: AccessibilityNode): string[] {
  const result: string[] = [];
  for (const property of node.properties ?? []) {
    if (!property.name || !STATE_PROPERTIES.has(property.name)) continue;
    const value = scalar(property.value);
    if (!value) continue;
    if (value === "true") result.push(property.name);
    else if (
      value !== "false" ||
      ["checked", "expanded", "pressed", "selected"].includes(property.name)
    ) {
      result.push(`${property.name}=${value}`);
    }
  }
  return result;
}

function shouldEmit(node: AccessibilityNode, parent: AccessibilityNode | undefined): boolean {
  if (node.ignored) return false;
  const role = scalar(node.role).toLowerCase();
  const name = compactText(scalar(node.name));
  const value = compactText(scalar(node.value));
  const states = stateTokens(node);
  if (!role && !name && !value && states.length === 0) return false;
  if (
    ["generic", "none", "presentation"].includes(role) &&
    !name &&
    !value &&
    states.length === 0
  ) {
    return false;
  }
  if (role === "inlinetextbox" || role === "linebreak") return false;
  if (role === "statictext" && parent && compactText(scalar(parent.name)) === name) return false;
  return true;
}

export function snapshotRefEligible(node: AccessibilityNode): boolean {
  const role = scalar(node.role).toLowerCase();
  return !node.ignored && node.backendDOMNodeId !== undefined && !NON_ELEMENT_ROLES.has(role);
}

export interface CompactAccessibilityTree {
  text: string;
  shown: number;
  total: number;
  truncated: boolean;
}

export function compactAccessibilityTree(
  nodes: AccessibilityNode[],
  refsByBackendId: ReadonlyMap<number, string>,
  maxNodes = 200,
): CompactAccessibilityTree {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const children = new Map<string, AccessibilityNode[]>();
  const roots: AccessibilityNode[] = [];

  for (const node of nodes) {
    if (node.parentId && byId.has(node.parentId)) {
      const siblings = children.get(node.parentId) ?? [];
      siblings.push(node);
      children.set(node.parentId, siblings);
    } else {
      roots.push(node);
    }
  }

  const lines: string[] = [];
  let total = 0;

  const visit = (
    node: AccessibilityNode,
    depth: number,
    emittedParent?: AccessibilityNode,
  ): void => {
    const emit = shouldEmit(node, emittedParent);
    const nextParent = emit ? node : emittedParent;
    const childDepth = emit ? depth + 1 : depth;

    if (emit) {
      total += 1;
      if (lines.length < maxNodes) {
        const role = compactText(scalar(node.role)) || "node";
        const name = compactText(scalar(node.name));
        const value = compactText(scalar(node.value));
        const ref =
          node.backendDOMNodeId === undefined
            ? undefined
            : refsByBackendId.get(node.backendDOMNodeId);
        const parts = [ref, role].filter(Boolean) as string[];
        if (name) parts.push(JSON.stringify(name));
        if (value && value !== name) parts.push(`value=${JSON.stringify(value)}`);
        const states = stateTokens(node);
        if (states.length) parts.push(`[${states.join(" ")}]`);
        lines.push(`${"  ".repeat(depth)}${parts.join(" ")}`);
      }
    }

    for (const child of children.get(node.nodeId) ?? []) {
      visit(child, childDepth, nextParent);
    }
  };

  for (const root of roots) visit(root, 0);

  return {
    text: lines.join("\n"),
    shown: lines.length,
    total,
    truncated: total > lines.length,
  };
}
