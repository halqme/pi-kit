import type { ExtensionAPI, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { renderFooter } from "./render.ts";

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return `${Math.round(tokens)}`;
}

function thinkingColor(effort: ThinkingLevel | undefined | "off"): ThemeColor {
  switch (effort) {
    case "minimal":
      return "thinkingMinimal";
    case "low":
      return "thinkingLow";
    case "medium":
      return "thinkingMinimal";
    case "high":
      return "thinkingHigh";
    case "xhigh":
      return "thinkingXhigh";
    case "max":
      return "thinkingMax";
    case "off":
      return "thinkingOff";
    default:
      return "error";
  }
}

export default function statusline(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
      return {
        dispose: unsubscribe,
        invalidate() {},
        render(width: number): string[] {
          const usage = ctx.getContextUsage();
          const context =
            usage?.percent !== null && usage?.percent !== undefined
              ? `ctx ${usage.percent.toFixed(1)}%/${formatTokens(usage.contextWindow)}`
              : "ctx ?";
          const branch = footerData.getGitBranch();
          const primary = [
            {
              text: theme.fg(
                ctx.isProjectTrusted() ? "success" : "warning",
                ctx.isProjectTrusted() ? "\uf2fc" : "\udb80\ude50",
              ),
            },
            {
              text: theme.fg(
                "accent",
                `${ctx.model?.provider ?? ""}/${ctx.model?.id ?? "no model"}`,
              ),
            },
            { text: theme.fg(thinkingColor(ctx.thinkingLevel), ctx.thinkingLevel ?? "off") },
            { text: theme.fg("muted", context) },
            ...(branch ? [{ text: theme.fg("success", ` ${branch}`) }] : []),
          ];
          const statuses = new Map(
            [...footerData.getExtensionStatuses()].map(([key, value]) => [
              theme.fg("dim", key),
              theme.fg("text", value),
            ]),
          );

          return renderFooter(primary, statuses, width);
        },
      };
    });
  });
}
