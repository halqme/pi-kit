import { resolve } from "node:path";
import {
  createCodingTools,
  createReadOnlyTools,
  DefaultResourceLoader,
  getAgentDir,
  type SourceInfo,
} from "@earendil-works/pi-coding-agent";
import { createMetrics } from "./analyze.ts";
import type {
  MetricsReport,
  ResourceMetrics,
  ResourceSource,
  ResourceStatus,
} from "./types.ts";

interface ResourceInventory {
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
): Promise<ResourceInventory> {
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

function status(available: boolean, used: boolean): ResourceStatus {
  if (available && used) return "available";
  return available ? "unused" : "missing";
}

/**
 * Enrich a historical report with the current Pi resources for one cwd.
 * Historical counts are never filtered or rewritten by current availability.
 */
export async function addCurrentResources(
  report: MetricsReport,
  cwd: string,
  agentDir?: string,
): Promise<MetricsReport> {
  const resolvedCwd = resolve(cwd);
  const inventory = await discoverPiResources(resolvedCwd, agentDir);
  const history = report.projects[cwd] ?? report.projects[resolvedCwd] ?? createMetrics();
  const resources: ResourceMetrics = {
    scope: resolvedCwd,
    tools: {},
    skills: {},
    diagnostics: inventory.diagnostics,
  };

  for (const name of new Set([...Object.keys(history.toolUsage), ...Object.keys(inventory.tools)])) {
    const calls = history.toolUsage[name]?.calls ?? 0;
    const source = inventory.tools[name];
    resources.tools[name] = {
      status: status(source !== undefined, calls > 0),
      calls,
      ...(source ? { source } : {}),
    };
  }

  for (const name of new Set([...Object.keys(history.skills), ...Object.keys(inventory.skills)])) {
    const usage = history.skills[name] ?? { reads: 0, explicit: 0 };
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
