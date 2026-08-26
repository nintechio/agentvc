import type { Tree } from "./types.js";

export type ChangeStatus = "added" | "modified" | "deleted";

export interface FileDiff {
  path: string;
  status: ChangeStatus;
}

export function diffTrees(oldTree: Tree, newTree: Tree): FileDiff[] {
  const diffs: FileDiff[] = [];
  for (const [p, entry] of Object.entries(newTree)) {
    const prev = oldTree[p];
    if (!prev) diffs.push({ path: p, status: "added" });
    else if (prev.hash !== entry.hash) diffs.push({ path: p, status: "modified" });
  }
  for (const p of Object.keys(oldTree)) {
    if (!newTree[p]) diffs.push({ path: p, status: "deleted" });
  }
  return diffs.sort((a, b) => a.path.localeCompare(b.path));
}
