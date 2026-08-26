import type { ChangeStatus } from "./diff.js";

export type HunkLineKind = "context" | "add" | "del";

export interface HunkLine {
  kind: HunkLineKind;
  text: string;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: HunkLine[];
}

export type PatchLimit = "binary" | "size" | "complexity";

export interface FilePatch {
  path: string;
  status: ChangeStatus;
  hunks: Hunk[];
  additions: number;
  deletions: number;
  limit?: PatchLimit;
}

export interface PatchOptions {
  context?: number;
  maxBytes?: number;
  maxLines?: number;
  maxEditDistance?: number;
}

export const DEFAULT_PATCH_OPTIONS: Required<PatchOptions> = {
  context: 3,
  maxBytes: 2 * 1024 * 1024,
  maxLines: 50_000,
  maxEditDistance: 2_000,
};

const BINARY_SNIFF_BYTES = 8_000;
const BINARY_NOISE_RATIO = 0.3;
const TEXT_CONTROL_BYTES = new Set([0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1b]);
const lenientUtf8 = new TextDecoder("utf-8");

export function isBinary(data: Buffer): boolean {
  const sample = data.subarray(0, BINARY_SNIFF_BYTES);
  if (!sample.length) return false;
  let noise = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 0x20 && !TEXT_CONTROL_BYTES.has(byte)) noise++;
  }
  for (const ch of lenientUtf8.decode(sample)) if (ch === "\ufffd") noise++;
  return noise / sample.length > BINARY_NOISE_RATIO;
}

export function splitLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (;;) {
    const nl = text.indexOf("\n", start);
    if (nl === -1) {
      if (start < text.length) lines.push(text.slice(start));
      return lines;
    }
    lines.push(text.slice(start, nl + 1));
    start = nl + 1;
  }
}

export function computePatch(
  filePath: string,
  status: ChangeStatus,
  oldData: Buffer | null,
  newData: Buffer | null,
  options: PatchOptions = {}
): FilePatch {
  const opts = { ...DEFAULT_PATCH_OPTIONS, ...options };
  const base: FilePatch = { path: filePath, status, hunks: [], additions: 0, deletions: 0 };
  const oldBuf = oldData ?? Buffer.alloc(0);
  const newBuf = newData ?? Buffer.alloc(0);

  if (isBinary(oldBuf) || isBinary(newBuf)) return { ...base, limit: "binary" };
  if (oldBuf.length > opts.maxBytes || newBuf.length > opts.maxBytes) return { ...base, limit: "size" };

  const oldLines = splitLines(oldBuf.toString("utf8"));
  const newLines = splitLines(newBuf.toString("utf8"));
  if (oldLines.length > opts.maxLines || newLines.length > opts.maxLines) return { ...base, limit: "size" };

  const exact = diffLines(oldLines, newLines, opts.maxEditDistance);
  const lines = exact ?? wholeReplace(oldLines, newLines);
  const hunks = buildHunks(lines, opts.context);
  const patch: FilePatch = {
    ...base,
    hunks,
    additions: lines.filter((l) => l.kind === "add").length,
    deletions: lines.filter((l) => l.kind === "del").length,
  };
  if (!exact) patch.limit = "complexity";
  return patch;
}

export function diffLines(a: string[], b: string[], maxEditDistance = Infinity): HunkLine[] | null {
  let prefix = 0;
  const maxPrefix = Math.min(a.length, b.length);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  const maxSuffix = maxPrefix - prefix;
  while (suffix < maxSuffix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;

  const middle = myers(
    a.slice(prefix, a.length - suffix),
    b.slice(prefix, b.length - suffix),
    maxEditDistance
  );
  if (!middle) return null;

  const out: HunkLine[] = [];
  for (let i = 0; i < prefix; i++) out.push({ kind: "context", text: a[i] ?? "" });
  out.push(...middle);
  for (let i = a.length - suffix; i < a.length; i++) out.push({ kind: "context", text: a[i] ?? "" });
  return out;
}

function wholeReplace(a: string[], b: string[]): HunkLine[] {
  return [
    ...a.map((text): HunkLine => ({ kind: "del", text })),
    ...b.map((text): HunkLine => ({ kind: "add", text })),
  ];
}

function myers(a: string[], b: string[], maxEditDistance: number): HunkLine[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxEditDistance);
  const trace: Int32Array[] = [];
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  v[offset + 1] = 0;

  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0));
      let x = down ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  if (!found) return null;

  const reversed: HunkLine[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const snapshot = trace[d];
    if (!snapshot) break;
    const at = (k: number): number => snapshot[k + d + 1] ?? 0;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      reversed.push({ kind: "context", text: a[x - 1] ?? "" });
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) reversed.push({ kind: "add", text: b[prevY] ?? "" });
      else reversed.push({ kind: "del", text: a[prevX] ?? "" });
    }
    x = prevX;
    y = prevY;
  }
  return reversed.reverse();
}

function buildHunks(lines: HunkLine[], context: number): Hunk[] {
  const changeIndexes: number[] = [];
  lines.forEach((l, i) => {
    if (l.kind !== "context") changeIndexes.push(i);
  });
  if (!changeIndexes.length) return [];

  const ranges: Array<[number, number]> = [];
  for (const idx of changeIndexes) {
    const last = ranges[ranges.length - 1];
    if (last && idx - last[1] - 1 <= 2 * context) last[1] = idx;
    else ranges.push([idx, idx]);
  }

  const oldPos: number[] = [];
  const newPos: number[] = [];
  let o = 0;
  let nw = 0;
  for (const l of lines) {
    oldPos.push(o);
    newPos.push(nw);
    if (l.kind !== "add") o++;
    if (l.kind !== "del") nw++;
  }

  return ranges.map(([first, last]) => {
    const lo = Math.max(0, first - context);
    const hi = Math.min(lines.length - 1, last + context);
    const slice = lines.slice(lo, hi + 1);
    const oldLines = slice.filter((l) => l.kind !== "add").length;
    const newLines = slice.filter((l) => l.kind !== "del").length;
    const oldBase = oldPos[lo] ?? 0;
    const newBase = newPos[lo] ?? 0;
    return {
      oldStart: oldLines === 0 ? oldBase : oldBase + 1,
      oldLines,
      newStart: newLines === 0 ? newBase : newBase + 1,
      newLines,
      lines: slice,
    };
  });
}

const NO_NEWLINE = "\\ No newline at end of file";

function hunkRange(start: number, count: number): string {
  return count === 1 ? String(start) : `${start},${count}`;
}

export function formatHunkHeader(h: Hunk): string {
  return `@@ -${hunkRange(h.oldStart, h.oldLines)} +${hunkRange(h.newStart, h.newLines)} @@`;
}

export function formatHunkLine(l: HunkLine): string[] {
  const marker = l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ";
  if (l.text.endsWith("\n")) return [marker + l.text.slice(0, -1)];
  return [marker + l.text, NO_NEWLINE];
}

export function patchHeader(p: FilePatch): { old: string; new: string } {
  return {
    old: p.status === "added" ? "/dev/null" : `a/${p.path}`,
    new: p.status === "deleted" ? "/dev/null" : `b/${p.path}`,
  };
}

export function formatPatch(p: FilePatch): string {
  const header = patchHeader(p);
  if (p.limit === "binary") return `Binary files ${header.old} and ${header.new} differ\n`;
  const out: string[] = [`--- ${header.old}`, `+++ ${header.new}`];
  if (p.limit === "size") {
    out.push(`(file exceeds the line-level diff size limit; contents omitted)`);
  } else {
    for (const h of p.hunks) {
      out.push(formatHunkHeader(h));
      for (const l of h.lines) out.push(...formatHunkLine(l));
    }
  }
  return `${out.join("\n")}\n`;
}

export function formatPatchSummary(patches: FilePatch[]): string {
  const additions = patches.reduce((sum, p) => sum + p.additions, 0);
  const deletions = patches.reduce((sum, p) => sum + p.deletions, 0);
  const parts = [`${patches.length} file${patches.length === 1 ? "" : "s"} changed`];
  if (additions) parts.push(`${additions} insertion${additions === 1 ? "" : "s"}(+)`);
  if (deletions) parts.push(`${deletions} deletion${deletions === 1 ? "" : "s"}(-)`);
  return parts.join(", ");
}
