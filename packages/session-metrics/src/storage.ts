import { appendFile, mkdir, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface IngestResult {
  indexed: number;
  skipped: number;
}

const seen = new Map<string, string>();
const liveEvents = join(homedir(), ".pi", "agent", "session-metrics.jsonl");

export async function sessionFiles(target: string): Promise<string[]> {
  const paths = new Set<string>();
  async function visit(path: string): Promise<void> {
    const info = await stat(path);
    if (info.isFile()) {
      if (path.endsWith(".jsonl")) paths.add(await realpath(path));
      return;
    }
    await Promise.all((await readdir(path)).map((name) => visit(join(path, name))));
  }
  await visit(target);
  return [...paths];
}

/** Kept for callers that need a cheap change summary; files are read directly for every report. */
export async function ingestSessions(target: string): Promise<IngestResult> {
  const files = await sessionFiles(target);
  let indexed = 0;
  let skipped = 0;
  for (const path of files) {
    const info = await stat(path);
    const signature = `${info.size}:${Math.trunc(info.mtimeMs)}`;
    if (seen.get(path) === signature) skipped++;
    else {
      seen.set(path, signature);
      indexed++;
    }
  }
  return { indexed, skipped };
}

export async function recordLiveEvent(event: {
  sessionId: string;
  eventType: string;
  toolCallId?: string;
  toolName?: string;
  payload?: unknown;
  isError?: boolean;
  createdAt?: number;
}): Promise<void> {
  const entry = { type: "session_metrics_event", timestamp: new Date(event.createdAt ?? Date.now()).toISOString(), ...event };
  await mkdir(join(homedir(), ".pi", "agent"), { recursive: true });
  await appendFile(liveEvents, `${JSON.stringify(entry)}\n`);
}
