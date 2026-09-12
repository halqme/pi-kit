import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import {
  normalizeTimeout,
  parseJsonStdout,
  runOsaProcess,
  type OsaLanguage,
  type OsaRunRequest,
  type OsaRunResult,
} from "./core.ts";

const TOOL_NAME = "macos_talk";

type MacOSTalkRuntime = {
  platform: NodeJS.Platform;
  run(request: OsaRunRequest): Promise<OsaRunResult>;
};

const systemRuntime: MacOSTalkRuntime = {
  platform: process.platform,
  run: runOsaProcess,
};

let runtime = systemRuntime;

export function setMacOSTalkRuntimeForTests(next?: Partial<MacOSTalkRuntime>): void {
  runtime = next ? { ...systemRuntime, ...next } : systemRuntime;
}

function languageLabel(language: OsaLanguage): string {
  return language === "applescript" ? "AppleScript" : "JXA";
}

function resultDetails(result: OsaRunResult): OsaRunResult & { value?: unknown } {
  const value = parseJsonStdout(result.stdout);
  return value === undefined ? result : { ...result, value };
}

export default function macosTalkExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: TOOL_NAME,
    label: "macOS Talk",
    description:
      "Execute AppleScript or JavaScript for Automation (JXA) directly through macOS osascript. Use macos_talk instead of shelling out to osascript through terminal when automating native applications, System Events, Accessibility/UI scripting, menus, windows, keyboard input, or application lifecycle. Scripts are sent on stdin, so shell quoting and heredocs are unnecessary. Prefer automation that does not change the frontmost application; macos_talk does not automatically activate applications or rewrite the supplied script. For complex observations, return JSON from the script so the result is exposed as structured value data.",
    promptGuidelines: [
      "Prefer macos_talk over invoking osascript through terminal for AppleScript or JXA automation.",
      "Avoid taking foreground focus unless the requested operation genuinely requires it. Prefer direct application scripting commands first, then System Events or Accessibility actions that work without activation, and activate the target application only when keyboard input, menus, or application behavior requires foreground focus.",
      "Do not add activate, set frontmost to true, or keystroke as a generic prelude. Use them only when the specific operation needs them.",
      "Prefer an application's scripting interface over UI scripting when both can perform the operation reliably.",
      "Use AppleScript for concise application commands and UI scripting; use JXA when JavaScript makes structured collection or transformation easier.",
      "When observing multiple values, return JSON from the script. Valid JSON stdout is also exposed in result details as value.",
      "Keep observation and mutation separate when practical, and verify consequential UI mutations through a queryable state or a screenshot when the result is primarily visual.",
    ],
    parameters: Type.Object(
      {
        language: Type.Optional(
          Type.Union([Type.Literal("applescript"), Type.Literal("javascript")], {
            description: "OSA language; defaults to applescript. javascript selects JXA.",
          }),
        ),
        script: Type.String({
          minLength: 1,
          description: "Complete AppleScript or JXA program sent to osascript on stdin",
        }),
        timeoutMs: Type.Optional(
          Type.Integer({
            minimum: 100,
            maximum: 120_000,
            description: "Execution timeout in milliseconds; defaults to 30000",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    renderCall(args, theme) {
      const language = languageLabel((args.language ?? "applescript") as OsaLanguage);
      const firstLine = args.script
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean);
      const preview = firstLine && firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
      return new Text(
        `${theme.fg("toolTitle", theme.bold(TOOL_NAME))} ${theme.fg("accent", language)}${preview ? ` ${theme.fg("dim", preview)}` : ""}`,
        0,
        0,
      );
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("warning", "Running macOS automation..."), 0, 0);
      const details = result.details as (OsaRunResult & { value?: unknown }) | undefined;
      let summary = context.isError
        ? details?.timedOut
          ? "Timed out"
          : details?.aborted
            ? "Aborted"
            : `Failed${details?.exitCode === null || details?.exitCode === undefined ? "" : ` (exit ${details.exitCode})`}`
        : `Done${details ? ` in ${details.durationMs}ms` : ""}`;
      if (expanded) {
        const content = result.content
          .filter((item) => item.type === "text")
          .map((item) => item.text ?? "")
          .join("\n");
        if (content) summary += `\n\n${content}`;
      }
      return new Text(theme.fg(context.isError ? "error" : "toolOutput", summary), 0, 0);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (runtime.platform !== "darwin") {
        throw new Error("macos_talk requires macOS");
      }
      if (!params.script.trim()) throw new Error("script must not be empty");

      const language = (params.language ?? "applescript") as OsaLanguage;
      const execution = await runtime.run({
        language,
        script: params.script,
        timeoutMs: normalizeTimeout(params.timeoutMs),
        cwd: ctx.cwd,
        ...(signal ? { signal } : {}),
      });
      const details = resultDetails(execution);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }],
        details,
        ...(execution.ok ? {} : { isError: true }),
      };
    },
  });
}
