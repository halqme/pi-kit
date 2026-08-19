import test from "node:test";
import assert from "node:assert/strict";
import {
  compactAccessibilityTree,
  snapshotRefEligible,
  type AccessibilityNode,
} from "./snapshot.ts";

const nodes: AccessibilityNode[] = [
  {
    nodeId: "1",
    ignored: false,
    role: { value: "RootWebArea" },
    name: { value: "Demo" },
  },
  {
    nodeId: "2",
    parentId: "1",
    ignored: false,
    role: { value: "generic" },
    name: { value: "" },
  },
  {
    nodeId: "3",
    parentId: "2",
    ignored: false,
    role: { value: "button" },
    name: { value: "Save" },
    backendDOMNodeId: 30,
    properties: [{ name: "disabled", value: { value: true } }],
  },
  {
    nodeId: "4",
    parentId: "3",
    ignored: false,
    role: { value: "StaticText" },
    name: { value: "Save" },
    backendDOMNodeId: 31,
  },
  {
    nodeId: "5",
    parentId: "2",
    ignored: true,
    role: { value: "none" },
  },
  {
    nodeId: "6",
    parentId: "5",
    ignored: false,
    role: { value: "link" },
    name: { value: "Docs" },
    backendDOMNodeId: 60,
  },
];

test("compactAccessibilityTree removes boilerplate while preserving useful refs and state", () => {
  const result = compactAccessibilityTree(nodes, new Map([[30, "e1"], [60, "e2"]]));
  assert.equal(
    result.text,
    'RootWebArea "Demo"\n  e1 button "Save" [disabled]\n  e2 link "Docs"',
  );
  assert.deepEqual(
    { shown: result.shown, total: result.total, truncated: result.truncated },
    { shown: 3, total: 3, truncated: false },
  );
  assert.equal(snapshotRefEligible(nodes[2]!), true);
  assert.equal(snapshotRefEligible(nodes[3]!), false);
});

test("compactAccessibilityTree caps output without hiding that the tree was truncated", () => {
  const result = compactAccessibilityTree(nodes, new Map([[30, "e1"], [60, "e2"]]), 2);
  assert.equal(result.shown, 2);
  assert.equal(result.total, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.text.split("\n").length, 2);
});
