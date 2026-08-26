import { watch as fsWatch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { loadIgnoreRules } from "./snapshot.js";
import type { AgentVCS } from "./repo.js";
import type { Checkpoint } from "./types.js";

export interface WatchOptions {
  debounceMs?: number;
  message?: string;
  onCheckpoint?: (cp: Checkpoint) => void;
  onError?: (err: unknown) => void;
}

export interface WorkspaceWatcher {
  close: () => void;
  flush: () => Promise<Checkpoint | null>;
}

export const DEFAULT_WATCH_DEBOUNCE_MS = 2_000;

export async function watchWorkspace(avc: AgentVCS, options: WatchOptions = {}): Promise<WorkspaceWatcher> {
  await avc.requireInit();
  const debounceMs = options.debounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS;
  const message = options.message ?? "auto: workspace changed";
  const ignore = await loadIgnoreRules(avc.root);

  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<Checkpoint | null> | null = null;
  let dirtyDuringSave = false;
  let closed = false;

  const runSave = async (): Promise<Checkpoint | null> => {
    if (inFlight) {
      dirtyDuringSave = true;
      return inFlight;
    }
    inFlight = (async () => {
      let last: Checkpoint | null = null;
      do {
        dirtyDuringSave = false;
        try {
          const cp = await avc.saveIfDirty({ message, meta: { auto: true, trigger: "watch" } });
          if (cp) {
            last = cp;
            options.onCheckpoint?.(cp);
          }
        } catch (err) {
          options.onError?.(err);
        }
      } while (dirtyDuringSave && !closed);
      inFlight = null;
      return last;
    })();
    return inFlight;
  };

  const schedule = (): void => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void runSave();
    }, debounceMs);
  };

  const isRelevant = (filename: string | Buffer | null): boolean => {
    if (!filename) return true;
    const rel = filename.toString().split("\\").join("/");
    return !ignore.ignores(rel);
  };

  const watcher: FSWatcher = fsWatch(avc.root, { recursive: true }, (_event, filename) => {
    if (isRelevant(filename)) schedule();
  });
  watcher.on("error", (err) => options.onError?.(err));

  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      watcher.close();
    },
    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return runSave();
    },
  };
}
