import type { LanguageId } from "./language-profile.ts";
import type { SyntaxSearchKind } from "./syntax-search.ts";

export type SyntaxAction = "inspect" | "search" | "replace";
export type InspectDetail = "outline" | "source";
export type ContinuationCapability = "inspect" | "source" | "replace";

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

export interface SearchRequest {
  action: "search";
  scope: string;
  language?: LanguageId;
  kind: SyntaxSearchKind;
  name?: string;
  source?: string;
}

export interface ReplaceRequest {
  action: "replace";
  continuation: Continuation;
  replacement: string;
}

export type SyntaxRequest = InspectRequest | SearchRequest | ReplaceRequest;

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

export interface SyntaxError {
  code: string;
  message: string;
}

export interface SyntaxResponse {
  ok: boolean;
  action: SyntaxAction;
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
  return JSON.stringify(response, null, 2);
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
