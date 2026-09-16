import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import type {
  ErrorClass,
  RuntimeFingerprint,
  SessionDiagnostics,
  SessionDiagnosticsSummary,
} from "./types.ts";

export const RUNTIME_FINGERPRINT_ENTRY = "pi-kit-runtime-fingerprint";

const errorClasses = new Set<ErrorClass>([
  "execution_failure",
  "agent_misuse",
  "expected_failure",
  "precondition",
]);

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function textContent(value: unknown): string {
  if (!Array.isArray(value)) return typeof value === "string" ? value : "";
  return value
    .map((block) => {
      const item = record(block);
      return item?.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function explicitErrorClass(details: unknown): ErrorClass | undefined {
  const value = string(record(details)?.errorClass);
  return value && errorClasses.has(value as ErrorClass) ? (value as ErrorClass) : undefined;
}

function prefixedErrorClass(content: unknown): ErrorClass | undefined {
  const text = textContent(content).trimStart();
  if (text.startsWith("execution_failure:")) return "execution_failure";
  if (text.startsWith("agent_misuse:")) return "agent_misuse";
  if (text.startsWith("expected_failure:")) return "expected_failure";
  if (text.startsWith("precondition:")) return "precondition";
  if (text.startsWith("unsupported_language:")) return "agent_misuse";
  return undefined;
}

function runtimeFingerprint(entry: RecordValue): RuntimeFingerprint | undefined {
  if (entry.type !== "custom" || entry.customType !== RUNTIME_FINGERPRINT_ENTRY) return undefined;
  const data = record(entry.data);
  const revision = string(data?.revision);
  const fingerprint = string(data?.fingerprint);
  if (!revision || !fingerprint) return undefined;
  return {
    revision,
    fingerprint,
    dirty: data?.dirty === true,
    ...(string(data?.capturedAt) ? { capturedAt: string(data?.capturedAt) } : {}),
  };
}

export function createSessionDiagnostics(): SessionDiagnostics {
  return {
    errors: {
      total: 0,
      classified: 0,
      unknown: 0,
      byClass: {
        execution_failure: 0,
        agent_misuse: 0,
        expected_failure: 0,
        precondition: 0,
      },
    },
    fingerprints: [],
  };
}

export function analyzeDiagnosticLine(target: SessionDiagnostics, line: string): void {
  if (!line.trim()) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  const entry = record(parsed);
  if (!entry) return;

  const fingerprint = runtimeFingerprint(entry);
  if (fingerprint) {
    if (!target.fingerprints.some((item) => item.fingerprint === fingerprint.fingerprint)) {
      target.fingerprints.push(fingerprint);
    }
    return;
  }

  if (entry.type !== "message") return;
  const message = record(entry.message);
  if (message?.role !== "toolResult" || message.isError !== true) return;

  target.errors.total++;
  const errorClass = explicitErrorClass(message.details) ?? prefixedErrorClass(message.content);
  if (!errorClass) {
    target.errors.unknown++;
    return;
  }
  target.errors.classified++;
  target.errors.byClass[errorClass]++;
}

export async function analyzeSessionDiagnostics(path: string): Promise<SessionDiagnostics> {
  const result = createSessionDiagnostics();
  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) analyzeDiagnosticLine(result, line);
  return result;
}

export function createSessionDiagnosticsSummary(): SessionDiagnosticsSummary {
  return {
    errors: {
      total: 0,
      classified: 0,
      unknown: 0,
      byClass: {
        execution_failure: 0,
        agent_misuse: 0,
        expected_failure: 0,
        precondition: 0,
      },
    },
    revisions: {},
  };
}

export function mergeSessionDiagnostics(
  target: SessionDiagnosticsSummary,
  source: SessionDiagnostics,
): SessionDiagnosticsSummary {
  target.errors.total += source.errors.total;
  target.errors.classified += source.errors.classified;
  target.errors.unknown += source.errors.unknown;
  for (const errorClass of errorClasses) {
    target.errors.byClass[errorClass] += source.errors.byClass[errorClass];
  }
  for (const fingerprint of source.fingerprints) {
    const item = (target.revisions[fingerprint.fingerprint] ??= {
      revision: fingerprint.revision,
      dirty: fingerprint.dirty,
      sessions: 0,
    });
    item.sessions++;
  }
  return target;
}
