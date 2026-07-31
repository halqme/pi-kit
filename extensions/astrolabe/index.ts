import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { edit } from "./src/edit.ts";
import { inspect } from "./src/inspect.ts";
import { HandleStore } from "./src/node-handles.ts";
import { record, type Metrics } from "./src/metrics.ts";

const GUIDANCE =
  "When editing code, use syntax_inspect with outline first. Expand only the needed nodes with structure or source, then run syntax_replace after identifying a sufficiently narrow syntax node.";
export default function treeStructuralEditExtension(pi: ExtensionAPI): void {
  const handles = new HandleStore();
  const metrics: Metrics = { calls: 0, inputChars: 0, outputChars: 0, elapsedMs: 0 };
  pi.registerTool({
    name: "syntax_inspect",
    label: "Tree Inspect",
    description: `${GUIDANCE} Navigate TypeScript files incrementally with Tree-sitter.`,
    promptSnippet: "Navigate a TypeScript file by syntax-tree nodes",
    promptGuidelines: [GUIDANCE],
    parameters: Type.Object({
      path: Type.String(),
      nodeId: Type.Optional(Type.String()),
      view: Type.Optional(
        Type.Union([Type.Literal("outline"), Type.Literal("structure"), Type.Literal("source")]),
      ),
      depth: Type.Optional(Type.Integer({ minimum: 0, maximum: 12 })),
    }),
    renderCall() {
      return new Text("", 0, 0);
    },
    renderResult() {
      return new Text("", 0, 0);
    },
    async execute(_id, params, _signal, _update, ctx) {
      const start = Date.now();
      try {
        const output = await inspect(params, ctx.cwd, handles);
        record(metrics, JSON.stringify(params).length, output, start);
        return { content: [{ type: "text", text: output }], details: { metrics } };
      } catch (error) {
        const text = String(error);
        record(metrics, JSON.stringify(params).length, text, start);
        return { content: [{ type: "text", text }], details: { metrics }, isError: true };
      }
    },
  });
  pi.registerTool({
    name: "syntax_replace",
    label: "Tree Edit",
    description:
      "Safely replace one previously inspected TypeScript syntax node by byte range; rejects stale or ambiguous nodes and reparses before atomic save.",
    promptSnippet: "Replace one selected syntax-tree node safely",
    parameters: Type.Object({
      path: Type.String(),
      nodeId: Type.String(),
      replacement: Type.String(),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const start = Date.now();
      try {
        const output = await edit(params, ctx.cwd, handles);
        record(metrics, JSON.stringify(params).length, output, start);
        return { content: [{ type: "text", text: output }], details: { metrics } };
      } catch (error) {
        const text = String(error);
        record(metrics, JSON.stringify(params).length, text, start);
        return { content: [{ type: "text", text }], details: { metrics }, isError: true };
      }
    },
  });
}
