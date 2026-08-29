import { watch, type FSWatcher } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const SETTINGS = join(homedir(), ".pi", "agent", "settings.json");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".md", ".json"]);
const IGNORED = new Set(["node_modules", ".git", "dist", "build"]);

function isLocalPackage(value: string): boolean {
  return !value.startsWith("npm:") && !value.startsWith("git:");
}

async function localRoots(cwd: string): Promise<string[]> {
  const roots = new Set([
    join(homedir(), ".pi", "agent", "extensions"),
    join(cwd, ".pi", "extensions"),
  ]);
  try {
    const settings = JSON.parse(await readFile(SETTINGS, "utf8")) as {
      extensions?: string[];
      packages?: string[];
    };
    for (const value of [...(settings.extensions ?? []), ...(settings.packages ?? [])]) {
      if (!isLocalPackage(value)) continue;
      const base = value.startsWith("/") ? value : resolve(dirname(SETTINGS), value);
      try {
        const info = await stat(base);
        roots.add(info.isDirectory() ? base : dirname(base));
      } catch {
        // Ignore deleted or unavailable package entries.
      }
    }
  } catch {
    // The default discovery roots are still useful without settings.json.
  }
  return [...roots];
}

function watchable(path: string): boolean {
  if ([...IGNORED].some((part) => path.split("/").includes(part))) return false;
  return SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf(".")));
}

export default function autoReloadExtension(pi: ExtensionAPI): void {
  let watchers: FSWatcher[] = [];
  let pending: { path: string; mtimeMs: number } | undefined;
  let lastNotice = "";

  function closeWatchers(): void {
    for (const watcher of watchers) watcher.close();
    watchers = [];
  }

  function notify(ctx: ExtensionContext): void {
    if (!pending) return;
    const key = `${pending.path}:${pending.mtimeMs}`;
    if (key === lastNotice) return;
    lastNotice = key;
    ctx.ui.notify(
      `Local resources changed: ${pending.path}\nRun /reload when the current work is safe to replace.`,
      "info",
    );
    ctx.ui.setStatus("auto-reload", "reload pending");
  }

  async function markChanged(path: string, ctx: ExtensionContext): Promise<void> {
    if (!watchable(path)) return;
    try {
      const mtimeMs = (await stat(path)).mtimeMs;
      if (!pending || mtimeMs > pending.mtimeMs) pending = { path, mtimeMs };
      notify(ctx);
    } catch {
      // The file may have been renamed or removed during an editor save.
    }
  }

  async function start(ctx: ExtensionContext): Promise<void> {
    closeWatchers();
    for (const root of await localRoots(ctx.cwd)) {
      try {
        const watcher = watch(root, { recursive: true }, (_event, filename) => {
          if (!filename) return;
          void markChanged(join(root, filename.toString()), ctx);
        });
        watcher.on("error", () => watcher.close());
        watchers.push(watcher);
      } catch {
        // A missing or unsupported root should not break the session.
      }
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    pending = undefined;
    lastNotice = "";
    await start(ctx);
  });

  pi.on("agent_end", (_event, ctx) => notify(ctx));

  pi.on("session_shutdown", (_event, ctx) => {
    closeWatchers();
    pending = undefined;
    ctx.ui.setStatus("auto-reload", undefined);
  });
}
