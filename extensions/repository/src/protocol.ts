import type { LanguageId } from "./language-profile.ts";
import type { SyntaxSearchKind } from "./syntax-search.ts";

export type SyntaxAction = "inspect" | "inspect_many" | "locate" | "search" | "edit" | "rename";
export type InspectDetail = "outline" | "source";
export type ContinuationCapability = "inspect" | "source" | "edit" | "rename";

/** Opaque, session-scoped reference. Pass this object unchanged to the next syntax action. */
export interface Continuation {
  token: string;
}

export interface InspectRequest {
  action: "inspect";
  continuation?: Continuation;
  path?: string;
  language?: LanguageId;
  detail?: InspectDetail;
  depth?: number;
}

export interface InspectManyRequest {
  action: "inspect_many";
  targets: Array<{ continuation: Continuation }>;
}

export interface LocateRequest {
  action: "locate";
  scope: string;
  symbols?: string[];
  terms?: string[];
  language?: LanguageId;
  maxCandidates?: number;
}

export interface SearchRequest {
  action: "search";
  scope: string;
  language?: LanguageId;
  kind: SyntaxSearchKind;
  name?: string;
  source?: string;
}

export interface EditRequest {
  action: "edit";
  continuation: Continuation;
  replacement: string;
}

export interface RenameRequest {
  action: "rename";
  continuation: Continuation;
  newName: string;
}

export type SyntaxRequest =
  | InspectRequest
  | InspectManyRequest
  | LocateRequest
  | SearchRequest
  | EditRequest
  | RenameRequest;

export interface SyntaxHandle {
  continuation: Continuation;
  path: string;
  type: string;
  range: {
    start: { row: number; column: number };
    end: { row: number; column: number };
  };
  capabilities: ContinuationCapability[];
}

export interface LocateCandidate {
  continuation: Continuation;
  path: string;
  type: string;
  name: string;
  parent?: string;
  signature: string;
  flow: {
    awaits: number;
    branches: number;
    calls: string[];
    returns: number;
    throws: number;
  };
  range: {
    start: { row: number; column: number };
    end: { row: number; column: number };
  };
  score?: number;
  reasons?: string[];
  sourceBytes?: number;
  source?: string;
}

export interface SyntaxError {
  code: string;
  message: string;
}

export interface SyntaxResponse {
  ok: boolean;
  action: SyntaxAction;
  outline?: string;
  source?: string;
  message?: string;
  data?: Record<string, unknown>;
  handles?: SyntaxHandle[];
  next?: SyntaxRequest[];
  error?: SyntaxError;
}

export function continuation(token: string): Continuation {
  return { token };
}

export function isContinuation(value: unknown): value is Continuation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { token?: unknown };
  return typeof candidate.token === "string" && candidate.token.length > 0;
}

export function responseText(response: SyntaxResponse): string {
  return JSON.stringify(response);
}

export function failure(
  action: SyntaxAction,
  code: string,
  message: string,
  next: SyntaxRequest[] = [],
): SyntaxResponse {
  return {
    ok: false,
    action,
    error: { code, message },
    ...(next.length > 0 ? { next } : {}),
  };
}
