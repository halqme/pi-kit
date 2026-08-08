import { resolve } from "node:path";
import {
  createCodingTools,
  createReadOnlyTools,
  DefaultResourceLoader,
  getAgentDir,
  type SourceInfo,
} from "@earendil-works/pi-coding-agent";
import type {
  MetricsReport,
  ResourceMetrics,
  ResourceSource,
  ResourceStatus,
} from "./types.ts";

export interface PiResourceInventory {
  tools: Record<string, ResourceSource>;
  skills: Record<string, ResourceSource>;
  diagnostics: string[];
}

function sourceInfo(info: SourceInfo | undefined): ResourceSource | undefined {
  if (!info) return undefined;
  return {
    path: info.path,
    source: info.source,
    scope: info.scope,
    origin: info.origin,
  };
}

function diagnosticText(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : undefined;
    const path = typeof record.path === "string" ? record.path : undefined;
    if (message) return path ? `${path}: ${message}` : message;
  }
  return String(value);
}

/**
 * Resolve the resources Pi itself would discover for `cwd`.
 *
 * This deliberately uses Pi's public resource loader instead of scanning npm, settings, or
 * extension source code independently. Loading extensions executes their registration factories,
 * just as Pi does during resource discovery; callers should therefore treat this as explicit
 * runtime enrichment rather than part of deterministic session parsing.
 */
export async function discoverPiResources(
  cwd: string,
  agentDir = getAgentDir(),
): Promise<PiResourceInventory> {
  const resolvedCwd = resolve(cwd);
  const loader = new DefaultResourceLoader({ cwd: resolvedCwd, agentDir });
  await loader.reload();

  const tools: Record<string, ResourceSource> = {};
  for (const tool of [...createCodingTools(resolvedCwd), ...createReadOnlyTools(resolvedCwd)]) {
    tools[tool.name] ??= { source: "builtin", origin: "builtin" };
  }

  const extensionResult = loader.getExtensions();
  for (const extension of extensionResult.extensions) {
    for (const name of extension.tools.keys()) tools[name] = sourceInfo(extension.sourceInfo) ?? {};
  }

  const skillResult = loader.getSkills();
  const skills: Record<string, ResourceSource> = {};
  for (const skill of skillResult.skills) skills[skill.name] = sourceInfo(skill.sourceInfo) ?? {};

  return {
    tools,
    skills,
    diagnostics: [
      ...extensionResult.errors.map(diagnosticText),
      ...skillResult.diagnostics.map(diagnosticText),
    ],
  };
}

function status(discovered: boolean, used: boolean): ResourceStatus {
  if (discovered && used) return "available";
  return discovered ? "unused" : "missing";
}

/**
 * Compare the selected historical report with one explicitly supplied current resource inventory.
 * `cwd` defines where the current Pi resource set is resolved; historical counts remain the report's
 * selected scope (for example all sessions, or all sessions after `since`). `missing` means only that
 * the resource is not discoverable in that current scope; it does not prove that a package was removed.
 */
export function addResourceInventory(
  report: MetricsReport,
  cwd: string,
  inventory: PiResourceInventory,
): MetricsReport {
  const resolvedCwd = resolve(cwd);
  const resources: ResourceMetrics = {
    scope: resolvedCwd,
    tools: {},
    skills: {},
    diagnostics: inventory.diagnostics,
  };

  for (const name of new Set([...Object.keys(report.toolUsage), ...Object.keys(inventory.tools)])) {
    const calls = report.toolUsage[name]?.calls ?? 0;
    const source = inventory.tools[name];
    resources.tools[name] = {
      status: status(source !== undefined, calls > 0),
      calls,
      ...(source ? { source } : {}),
    };
  }

  for (const name of new Set([...Object.keys(report.skills), ...Object.keys(inventory.skills)])) {
    const usage = report.skills[name] ?? { reads: 0, explicit: 0 };
    const source = inventory.skills[name];
    resources.skills[name] = {
      status: status(source !== undefined, usage.reads + usage.explicit > 0),
      reads: usage.reads,
      explicit: usage.explicit,
      ...(source ? { source } : {}),
    };
  }

  report.resources = resources;
  return report;
}

/**
 * Enrich a historical report with the current Pi resources for one cwd.
 * Historical counts are never filtered or rewritten by current discoverability.
 */
export async function addCurrentResources(
  report: MetricsReport,
  cwd: string,
  agentDir?: string,
): Promise<MetricsReport> {
  const inventory = await discoverPiResources(cwd, agentDir);
  return addResourceInventory(report, cwd, inventory);
}
