import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { LanguageAdapter, LspServerSpec } from "./language-profile.ts";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspTextEdit {
  range: LspRange;
  newText: string;
}

export interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: unknown[];
}

export interface LspSymbol {
  name: string;
  containerName?: string;
  uri: string;
  range: LspRange;
}

export class LspError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LspError";
  }
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcError;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface InitializeResult {
  capabilities?: {
    positionEncoding?: string;
    workspaceSymbolProvider?: boolean | object;
    renameProvider?: boolean | { prepareProvider?: boolean };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPosition(value: unknown): value is LspPosition {
  return (
    isRecord(value) &&
    typeof value.line === "number" &&
    Number.isInteger(value.line) &&
    value.line >= 0 &&
    typeof value.character === "number" &&
    Number.isInteger(value.character) &&
    value.character >= 0
  );
}

function isRange(value: unknown): value is LspRange {
  return isRecord(value) && isPosition(value.start) && isPosition(value.end);
}

function normalizeWorkspaceSymbols(value: unknown): LspSymbol[] {
  if (!Array.isArray(value)) return [];
  const symbols: LspSymbol[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.name !== "string" || !isRecord(item.location)) continue;
    const uri = item.location.uri;
    const range = item.location.range;
    if (typeof uri !== "string" || !isRange(range)) continue;
    symbols.push({
      name: item.name,
      ...(typeof item.containerName === "string" ? { containerName: item.containerName } : {}),
      uri,
      range,
    });
  }
  return symbols;
}

function commandDescription(spec: LspServerSpec): string {
  return [spec.command, ...(spec.args ?? [])].join(" ");
}

class LspClient {
  private child: ChildProcessWithoutNullStreams | undefined;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private initialized = false;
  private capabilities: InitializeResult["capabilities"] = {};
  private opened = new Map<string, { source: string; version: number }>();
  private stderrTail = "";

  private constructor(
    private readonly cwd: string,
    private readonly languageId: string,
    private readonly server: LspServerSpec,
  ) {}

  static async connect(cwd: string, adapter: LanguageAdapter): Promise<LspClient> {
    const servers = adapter.lsp?.servers ?? [];
    if (servers.length === 0) {
      throw new LspError("lsp_unavailable", `No LSP server is configured for ${adapter.id}.`);
    }
    const failures: string[] = [];
    for (const server of servers) {
      const client = new LspClient(cwd, adapter.id, server);
      try {
        await client.start();
        return client;
      } catch (error) {
        failures.push(`${commandDescription(server)}: ${String(error)}`);
        await client.dispose(false);
      }
    }
    throw new LspError(
      "lsp_unavailable",
      `No configured ${adapter.id} language server could be started. ${failures.join(" | ")}`,
    );
  }

  private async start(): Promise<void> {
    const child = spawn(this.server.command, [...(this.server.args ?? [])], {
      cwd: this.cwd,
      stdio: "pipe",
      windowsHide: true,
    });
    this.child = child;
    await new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        child.off("error", onError);
        resolve();
      };
      const onError = (error: Error): void => {
        child.off("spawn", onSpawn);
        reject(error);
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
    });

    child.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString("utf8")}`.slice(-4_096);
    });
    child.once("exit", (code, signal) => {
      const suffix = this.stderrTail.trim() ? `: ${this.stderrTail.trim()}` : "";
      this.failPending(
        new LspError(
          "lsp_exited",
          `${commandDescription(this.server)} exited (${code ?? signal ?? "unknown"})${suffix}`,
        ),
      );
      this.child = undefined;
      this.initialized = false;
    });

    const rootUri = pathToFileURL(this.cwd).href;
    const result = (await this.request(
      "initialize",
      {
        processId: process.pid,
        clientInfo: { name: "astrolabe" },
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: basename(this.cwd) }],
        capabilities: {
          general: { positionEncodings: ["utf-16"] },
          workspace: {
            workspaceEdit: { documentChanges: true },
            symbol: {},
          },
          textDocument: {
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            rename: { prepareSupport: true },
          },
        },
      },
      10_000,
    )) as InitializeResult;
    this.capabilities = isRecord(result?.capabilities) ? result.capabilities : {};
    const positionEncoding = this.capabilities?.positionEncoding ?? "utf-16";
    if (positionEncoding !== "utf-16") {
      throw new LspError(
        "unsupported_position_encoding",
        `Astrolabe currently requires UTF-16 LSP positions, but ${this.server.command} selected ${positionEncoding}.`,
      );
    }
    this.notify("initialized", {});
    this.initialized = true;
  }

  async workspaceSymbols(query: string): Promise<LspSymbol[]> {
    if (this.capabilities?.workspaceSymbolProvider === false) return [];
    try {
      return normalizeWorkspaceSymbols(await this.request("workspace/symbol", { query }, 8_000));
    } catch (error) {
      if (error instanceof LspError && error.code === "lsp_method_not_found") return [];
      throw error;
    }
  }

  async rename(path: string, position: LspPosition, newName: string): Promise<LspWorkspaceEdit> {
    if (this.capabilities?.renameProvider === false) {
      throw new LspError("rename_unavailable", `${this.languageId} language server does not support rename.`);
    }
    await this.syncDocument(path);
    const textDocument = { uri: pathToFileURL(path).href };
    const renameProvider = this.capabilities?.renameProvider;
    if (isRecord(renameProvider) && renameProvider.prepareProvider === true) {
      const prepared = await this.request(
        "textDocument/prepareRename",
        { textDocument, position },
        8_000,
      );
      if (prepared === null) {
        throw new LspError("rename_unavailable", "The language server rejected rename at this symbol.");
      }
    }
    const edit = await this.request(
      "textDocument/rename",
      { textDocument, position, newName },
      12_000,
    );
    if (!isRecord(edit)) {
      throw new LspError("rename_unavailable", "The language server returned no WorkspaceEdit.");
    }
    return edit as LspWorkspaceEdit;
  }

  private async syncDocument(path: string): Promise<void> {
    const source = await readFile(path, "utf8");
    const uri = pathToFileURL(path).href;
    const previous = this.opened.get(path);
    if (previous?.source === source) return;
    if (previous) {
      this.notify("textDocument/didClose", { textDocument: { uri } });
    }
    const version = (previous?.version ?? 0) + 1;
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId: this.languageId, version, text: source },
    });
    this.opened.set(path, { source, version });
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LspError("lsp_timeout", `${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(message: JsonRpcMessage): void {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed) {
      throw new LspError("lsp_unavailable", "Language server stdin is not available.");
    }
    const body = JSON.stringify(message);
    stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /^Content-Length:\s*(\d+)\s*$/im.exec(header);
      if (!match?.[1]) {
        this.failPending(new LspError("lsp_protocol_error", "Missing Content-Length header."));
        this.buffer = Buffer.alloc(0);
        return;
      }
      const contentLength = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + contentLength).toString("utf8");
      this.buffer = this.buffer.subarray(bodyStart + contentLength);
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(body) as JsonRpcMessage;
      } catch {
        this.failPending(new LspError("lsp_protocol_error", "Language server returned invalid JSON."));
        continue;
      }
      this.onMessage(message);
    }
  }

  private onMessage(message: JsonRpcMessage): void {
    if (message.method && message.id !== undefined && message.id !== null) {
      this.respondToServerRequest(message);
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(
        new LspError(
          message.error.code === -32601 ? "lsp_method_not_found" : "lsp_request_failed",
          `${message.error.message}${message.error.data === undefined ? "" : `: ${JSON.stringify(message.error.data)}`}`,
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  private respondToServerRequest(message: JsonRpcMessage): void {
    const id = message.id as number | string;
    let result: unknown = null;
    if (message.method === "workspace/configuration") {
      const items = isRecord(message.params) && Array.isArray(message.params.items) ? message.params.items : [];
      result = items.map(() => null);
    } else if (message.method === "workspace/workspaceFolders") {
      const rootUri = pathToFileURL(this.cwd).href;
      result = [{ uri: rootUri, name: basename(this.cwd) }];
    } else if (message.method === "workspace/applyEdit") {
      result = { applied: false, failureReason: "Astrolabe only applies explicitly returned WorkspaceEdit values." };
    } else if (
      message.method !== "client/registerCapability" &&
      message.method !== "client/unregisterCapability" &&
      message.method !== "window/workDoneProgress/create"
    ) {
      this.send({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: `Unsupported client request: ${message.method}` },
      });
      return;
    }
    this.send({ jsonrpc: "2.0", id, result });
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async dispose(graceful = true): Promise<void> {
    const child = this.child;
    if (!child) return;
    if (graceful && this.initialized) {
      for (const path of this.opened.keys()) {
        this.notify("textDocument/didClose", { textDocument: { uri: pathToFileURL(path).href } });
      }
      try {
        await this.request("shutdown", null, 2_000);
        this.notify("exit", null);
      } catch {
        // Fall through to process termination.
      }
    }
    this.opened.clear();
    this.initialized = false;
    if (!child.killed) child.kill();
    this.child = undefined;
  }
}

export interface LspService {
  workspaceSymbols(adapter: LanguageAdapter, cwd: string, query: string): Promise<LspSymbol[]>;
  rename(
    adapter: LanguageAdapter,
    cwd: string,
    path: string,
    position: LspPosition,
    newName: string,
  ): Promise<LspWorkspaceEdit>;
  shutdown(): Promise<void>;
}

export class LspManager implements LspService {
  private readonly sessions = new Map<string, Promise<LspClient | undefined>>();

  private client(adapter: LanguageAdapter, cwd: string): Promise<LspClient | undefined> {
    const key = `${cwd}\0${adapter.id}`;
    const active = this.sessions.get(key);
    if (active) return active;
    const pending = LspClient.connect(cwd, adapter).catch((error) => {
      if (error instanceof LspError && error.code === "lsp_unavailable") return undefined;
      return undefined;
    });
    this.sessions.set(key, pending);
    return pending;
  }

  async workspaceSymbols(adapter: LanguageAdapter, cwd: string, query: string): Promise<LspSymbol[]> {
    const client = await this.client(adapter, cwd);
    if (!client) return [];
    try {
      return await client.workspaceSymbols(query);
    } catch {
      return [];
    }
  }

  async rename(
    adapter: LanguageAdapter,
    cwd: string,
    path: string,
    position: LspPosition,
    newName: string,
  ): Promise<LspWorkspaceEdit> {
    const client = await this.client(adapter, cwd);
    if (!client) {
      throw new LspError(
        "lsp_unavailable",
        `No configured ${adapter.id} language server is available. Install one of: ${(adapter.lsp?.servers ?? []).map(commandDescription).join(", ")}.`,
      );
    }
    return client.rename(path, position, newName);
  }

  async shutdown(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    const clients = await Promise.allSettled(sessions);
    await Promise.allSettled(
      clients.flatMap((result) =>
        result.status === "fulfilled" && result.value ? [result.value.dispose()] : [],
      ),
    );
  }
}
