export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
  cost: number;
  cacheCost: number;
}

export interface ToolMetrics {
  calls: number;
  estimatedResultTokens: number;
  reportedTokens: number;
  errors: number;
  completedCalls: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

export interface LogicalOperationMetrics {
  operations: number;
  toolCalls: number;
  returnedTokens: number;
  wallClockMs: number;
  errors: number;
  retries: number;
  successes: number;
}

export interface SkillMetrics {
  reads: number;
  explicit: number;
}

/** Current-Pi discoverability compared with the selected historical usage. */
export type ResourceStatus = "available" | "missing" | "unused";

export interface ResourceSource {
  path?: string;
  source?: string;
  origin?: string;
  scope?: string;
}

export interface ToolResourceMetrics {
  status: ResourceStatus;
  calls: number;
  source?: ResourceSource;
}

export interface SkillResourceMetrics extends SkillMetrics {
  status: ResourceStatus;
  source?: ResourceSource;
}

export interface ResourceMetrics {
  scope: string;
  tools: Record<string, ToolResourceMetrics>;
  skills: Record<string, SkillResourceMetrics>;
  diagnostics: string[];
}

export interface SourceDiagnostic {
  path: string;
  status: "missing" | "error";
  code: string;
  message: string;
}

export interface MetricSummary {
  sessions: number;
  messages: number;
  userMessages: number;
  assistantMessages: number;
  toolResults: number;
  turns: number;
  toolCalls: number;
  toolCallsByName: Record<string, number>;
  toolUsage: Record<string, ToolMetrics>;
  toolActions: Record<string, Record<string, ToolMetrics>>;
  logicalOperations: LogicalOperationMetrics;
  skills: Record<string, SkillMetrics>;
  models: Record<string, { messages: number; usage: UsageTotals }>;
  thinkingLevels: Record<string, { messages: number; usage: UsageTotals }>;
  modelEfforts: Record<
    string,
    { provider: string; model: string; effort: string; messages: number; usage: UsageTotals }
  >;
  toolErrors: number;
  modelErrors: number;
  errors: number;
  invalidLines: number;
  tokens: UsageTotals;
}

export interface SessionMetrics extends MetricSummary {
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
}

export interface MetricsReport extends MetricSummary {
  daily: Record<string, MetricSummary>;
  weekly: Record<string, MetricSummary>;
  monthly: Record<string, MetricSummary>;
  projects: Record<string, MetricSummary>;
  resources?: ResourceMetrics;
  source?: SourceDiagnostic;
}
