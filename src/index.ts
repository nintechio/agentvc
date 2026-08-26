export { AgentVCS, AvcError } from "./core/repo.js";
export type {
  SaveOptions,
  StatusResult,
  BranchInfo,
  TimelineEntry,
  RestoreResult,
} from "./core/repo.js";
export { watchWorkspace, DEFAULT_WATCH_DEBOUNCE_MS } from "./core/watch.js";
export type { WatchOptions, WorkspaceWatcher } from "./core/watch.js";
export { claudeHookSettings, mergeHookSettings } from "./hooks.js";
export type { HookSettings, HookGroup, HookCommand, ClaudeHookOptions } from "./hooks.js";
export { diffTrees } from "./core/diff.js";
export type { FileDiff, ChangeStatus } from "./core/diff.js";
export {
  computePatch,
  diffLines,
  formatPatch,
  formatPatchSummary,
  splitLines,
  DEFAULT_PATCH_OPTIONS,
} from "./core/patch.js";
export type { FilePatch, Hunk, HunkLine, HunkLineKind, PatchLimit, PatchOptions } from "./core/patch.js";
export type { Checkpoint, Tree, TreeEntry, Index, IndexEntry } from "./core/types.js";
