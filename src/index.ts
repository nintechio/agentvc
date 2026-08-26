export { AgentVCS, AvcError } from "./core/repo.js";
export type {
  SaveOptions,
  StatusResult,
  BranchInfo,
  TimelineEntry,
  RestoreResult,
} from "./core/repo.js";
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
