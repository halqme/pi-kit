import { SessionManager } from "@earendil-works/pi-coding-agent";

export const THREAD_ENTRY_TYPE = "threads:spawned-session";

export interface SpawnedThread {
  id: string;
  sessionId: string;
  sessionFile: string;
  parentSession?: string;
  cwd: string;
  createdAt: string;
}

export function createThreadSession(
  cwd: string,
  sessionDir: string,
  parentSession: string | undefined,
  id: string,
): SpawnedThread {
  const manager = SessionManager.create(
    cwd,
    sessionDir,
    parentSession ? { parentSession } : undefined,
  );
  const sessionFile = manager.getSessionFile();
  const header = manager.getHeader();
  if (!sessionFile || !header) throw new Error("Pi did not allocate a persistent session");
  return {
    id,
    sessionId: manager.getSessionId(),
    sessionFile,
    ...(parentSession ? { parentSession } : {}),
    cwd,
    createdAt: header.timestamp,
  };
}

export function recordedThreads(entries: readonly unknown[]): SpawnedThread[] {
  const threads: SpawnedThread[] = [];
  for (const value of entries) {
    if (!value || typeof value !== "object") continue;
    const entry = value as { type?: unknown; customType?: unknown; data?: unknown };
    if (entry.type !== "custom" || entry.customType !== THREAD_ENTRY_TYPE) continue;
    if (!entry.data || typeof entry.data !== "object") continue;
    const data = entry.data as Partial<SpawnedThread>;
    if (
      typeof data.id === "string" &&
      typeof data.sessionId === "string" &&
      typeof data.sessionFile === "string" &&
      typeof data.cwd === "string" &&
      typeof data.createdAt === "string"
    ) {
      threads.push(data as SpawnedThread);
    }
  }
  return threads;
}
