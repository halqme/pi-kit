import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface Loop {
  message: string;
  remaining: number;
  intervalMs: number;
  active: boolean;
}
export default function loopExtension(pi: ExtensionAPI): void {
  let loop: Loop | undefined;
  pi.registerTool({
    name: "loop",
    label: "Loop",
    description:
      "Start, inspect, or stop a generic agent-end loop. Use it to repeat a bounded follow-up action until a caller-defined condition is met.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("start"), Type.Literal("status"), Type.Literal("stop")]),
      message: Type.Optional(Type.String()),
      iterations: Type.Optional(Type.Integer({ minimum: 1 })),
      intervalMs: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      if (params.action === "stop") {
        loop = undefined;
        return { content: [{ type: "text" as const, text: "Loop stopped." }], details: {} };
      }
      if (params.action === "status")
        return {
          content: [
            {
              type: "text" as const,
              text: loop?.active ? `Loop active (${loop.remaining} remaining)` : "No active loop.",
            },
          ],
          details: loop ?? {},
        };
      if (!params.message?.trim())
        return {
          content: [{ type: "text" as const, text: "message is required" }],
          details: {},
          isError: true,
        };
      loop = {
        message: params.message.trim(),
        remaining: params.iterations ?? 1,
        intervalMs: params.intervalMs ?? 0,
        active: true,
      };
      if (ctx.isIdle()) pi.sendUserMessage(loop.message, { deliverAs: "followUp" });
      return {
        content: [{ type: "text" as const, text: `Loop started (${loop.remaining} iterations).` }],
        details: loop,
      };
    },
  });
  pi.on("agent_end", async () => {
    if (!loop?.active) return;
    loop.remaining -= 1;
    if (loop.remaining <= 0) {
      loop = undefined;
      return;
    }
    if (loop.intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, loop!.intervalMs));
    if (loop?.active) pi.sendUserMessage(loop.message, { deliverAs: "followUp" });
  });
}
