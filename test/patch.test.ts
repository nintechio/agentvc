import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AgentVCS,
  computePatch,
  diffLines,
  formatPatch,
  formatPatchSummary,
  splitLines,
} from "../src/index.js";
import type { FilePatch, HunkLine } from "../src/index.js";

function text(...lines: string[]): Buffer {
  return Buffer.from(lines.map((l) => `${l}\n`).join(""), "utf8");
}

function applyLines(lines: HunkLine[]): { old: string; new: string } {
  let oldText = "";
  let newText = "";
  for (const l of lines) {
    if (l.kind !== "add") oldText += l.text;
    if (l.kind !== "del") newText += l.text;
  }
  return { old: oldText, new: newText };
}

function applyPatch(p: FilePatch, oldText: string): string {
  const oldLines = splitLines(oldText);
  let cursor = 0;
  let out = "";
  for (const h of p.hunks) {
    const start = h.oldLines === 0 ? h.oldStart : h.oldStart - 1;
    out += oldLines.slice(cursor, start).join("");
    cursor = start;
    for (const l of h.lines) {
      if (l.kind === "context") {
        expect(oldLines[cursor]).toBe(l.text);
        out += l.text;
        cursor++;
      } else if (l.kind === "del") {
        expect(oldLines[cursor]).toBe(l.text);
        cursor++;
      } else {
        out += l.text;
      }
    }
  }
  return out + oldLines.slice(cursor).join("");
}

function pseudoRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

describe("splitLines", () => {
  it("keeps terminators and distinguishes a missing trailing newline", () => {
    expect(splitLines("a\nb\n")).toEqual(["a\n", "b\n"]);
    expect(splitLines("a\nb")).toEqual(["a\n", "b"]);
    expect(splitLines("")).toEqual([]);
    expect(splitLines("\n")).toEqual(["\n"]);
  });
});

describe("diffLines", () => {
  it("returns only context for identical input", () => {
    const lines = diffLines(["a\n", "b\n"], ["a\n", "b\n"]);
    expect(lines?.every((l) => l.kind === "context")).toBe(true);
  });

  it("produces an edit script that reconstructs both sides", () => {
    const a = ["x\n", "a\n", "b\n", "c\n", "d\n", "e\n", "z\n"];
    const b = ["x\n", "a\n", "B\n", "c\n", "e\n", "f\n", "z\n"];
    const lines = diffLines(a, b)!;
    expect(applyLines(lines)).toEqual({ old: a.join(""), new: b.join("") });
    expect(lines.filter((l) => l.kind === "del").map((l) => l.text)).toEqual(["b\n", "d\n"]);
    expect(lines.filter((l) => l.kind === "add").map((l) => l.text)).toEqual(["B\n", "f\n"]);
  });

  it("is minimal for classic Myers example", () => {
    const lines = diffLines(["a", "b", "c", "a", "b", "b", "a"], ["c", "b", "a", "b", "a", "c"])!;
    expect(lines.filter((l) => l.kind !== "context")).toHaveLength(5);
  });

  it("handles empty sides", () => {
    expect(diffLines([], [])).toEqual([]);
    expect(diffLines([], ["a\n"])).toEqual([{ kind: "add", text: "a\n" }]);
    expect(diffLines(["a\n"], [])).toEqual([{ kind: "del", text: "a\n" }]);
  });

  it("returns null when the edit distance exceeds the cap", () => {
    const a = ["1\n", "2\n", "3\n", "4\n"];
    const b = ["5\n", "6\n", "7\n", "8\n"];
    expect(diffLines(a, b, 4)).toBeNull();
    expect(diffLines(a, b, 8)).not.toBeNull();
  });

  it("round-trips randomised edits", () => {
    const rand = pseudoRandom(42);
    for (let round = 0; round < 40; round++) {
      const base = Array.from({ length: 60 }, (_, i) => `line ${i % 7}\n`);
      const edited = base
        .filter(() => rand() > 0.15)
        .flatMap((l) => (rand() > 0.85 ? [l, `inserted ${Math.floor(rand() * 5)}\n`] : [l]))
        .map((l) => (rand() > 0.9 ? `changed ${Math.floor(rand() * 5)}\n` : l));
      const lines = diffLines(base, edited)!;
      expect(applyLines(lines)).toEqual({ old: base.join(""), new: edited.join("") });
    }
  });
});

describe("computePatch / formatPatch", () => {
  it("renders a modification as a unified diff with 3 lines of context", () => {
    const oldData = text("one", "two", "three", "four", "five", "six", "seven", "eight");
    const newData = text("one", "two", "three", "FOUR", "five", "six", "seven", "eight");
    const p = computePatch("src/app.ts", "modified", oldData, newData);
    expect(p.additions).toBe(1);
    expect(p.deletions).toBe(1);
    expect(p.limit).toBeUndefined();
    expect(formatPatch(p)).toBe(
      [
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -1,7 +1,7 @@",
        " one",
        " two",
        " three",
        "-four",
        "+FOUR",
        " five",
        " six",
        " seven",
        "",
      ].join("\n")
    );
  });

  it("splits distant changes into separate hunks and merges near ones", () => {
    const base = Array.from({ length: 30 }, (_, i) => `l${i + 1}`);
    const changed = base.map((l) => (l === "l5" || l === "l25" ? `${l}!` : l));
    const two = computePatch("f", "modified", text(...base), text(...changed));
    expect(two.hunks.map((h) => `${h.oldStart},${h.oldLines}`)).toEqual(["2,7", "22,7"]);

    const near = base.map((l) => (l === "l5" || l === "l10" ? `${l}!` : l));
    const one = computePatch("f", "modified", text(...base), text(...near));
    expect(one.hunks).toHaveLength(1);
    expect(one.hunks[0]?.oldStart).toBe(2);
    expect(one.hunks[0]?.oldLines).toBe(12);
  });

  it("uses /dev/null and single-line ranges for added and deleted files", () => {
    const added = computePatch("new.txt", "added", null, text("hello"));
    expect(formatPatch(added)).toBe("--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+hello\n");
    expect(added.additions).toBe(1);

    const deleted = computePatch("old.txt", "deleted", text("bye", "now"), null);
    expect(formatPatch(deleted)).toBe("--- a/old.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-bye\n-now\n");
    expect(deleted.deletions).toBe(2);
  });

  it("marks a missing trailing newline", () => {
    const p = computePatch("f", "modified", Buffer.from("a\nb"), Buffer.from("a\nb\n"));
    expect(formatPatch(p)).toBe(
      ["--- a/f", "+++ b/f", "@@ -1,2 +1,2 @@", " a", "-b", "\\ No newline at end of file", "+b", ""].join("\n")
    );
  });

  it("detects binary content", () => {
    const p = computePatch("img.png", "modified", Buffer.from([0x89, 0x50, 0x00, 0x01]), Buffer.from([0x89, 0x50, 0x00, 0x02]));
    expect(p.limit).toBe("binary");
    expect(p.hunks).toEqual([]);
    expect(formatPatch(p)).toBe("Binary files a/img.png and b/img.png differ\n");

    const addedBinary = computePatch("blob.bin", "added", null, Buffer.from([0x00]));
    expect(formatPatch(addedBinary)).toBe("Binary files /dev/null and b/blob.bin differ\n");
  });

  it("treats NUL-free random bytes as binary but accented text as text", () => {
    const rand = pseudoRandom(99);
    const noise = Buffer.from(Array.from({ length: 64 }, () => 1 + Math.floor(rand() * 255)));
    expect(computePatch("noise.bin", "added", null, noise).limit).toBe("binary");

    const utf8 = Buffer.from("café — naïve façade ✓\n", "utf8");
    expect(computePatch("t.txt", "added", null, utf8).limit).toBeUndefined();
    const latin1 = Buffer.from("caf\xe9 na\xefve fa\xe7ade, plus ordinary words\n", "latin1");
    expect(computePatch("t.txt", "added", null, latin1).limit).toBeUndefined();
    const crlf = Buffer.from("line\r\n\ttabbed\r\n", "utf8");
    expect(computePatch("t.txt", "added", null, crlf).limit).toBeUndefined();
  });

  it("skips files over the byte or line limits", () => {
    const big = Buffer.alloc(64, 0x61);
    const p = computePatch("big.txt", "modified", big, Buffer.alloc(65, 0x61), { maxBytes: 64 });
    expect(p.limit).toBe("size");
    expect(formatPatch(p)).toContain("size limit");

    const manyLines = computePatch("m.txt", "added", null, text(...Array(11).fill("x")), { maxLines: 10 });
    expect(manyLines.limit).toBe("size");
  });

  it("falls back to a whole-file replacement when the edit distance cap is exceeded", () => {
    const oldData = text(...Array.from({ length: 50 }, (_, i) => `old ${i}`));
    const newData = text(...Array.from({ length: 50 }, (_, i) => `new ${i}`));
    const p = computePatch("f", "modified", oldData, newData, { maxEditDistance: 10 });
    expect(p.limit).toBe("complexity");
    expect(p.hunks).toHaveLength(1);
    expect(p.deletions).toBe(50);
    expect(p.additions).toBe(50);
    expect(applyPatch(p, oldData.toString("utf8"))).toBe(newData.toString("utf8"));
  });

  it("produces hunks that apply cleanly to the original", () => {
    const rand = pseudoRandom(7);
    for (let round = 0; round < 25; round++) {
      const base = Array.from({ length: 80 }, (_, i) => `v${i % 9}`);
      const edited = base
        .filter(() => rand() > 0.1)
        .flatMap((l) => (rand() > 0.9 ? [l, "ins"] : [l]))
        .map((l) => (rand() > 0.92 ? "chg" : l));
      const oldText = `${base.join("\n")}\n`;
      const newText = `${edited.join("\n")}\n`;
      const context = round % 4;
      const p = computePatch("f", "modified", Buffer.from(oldText), Buffer.from(newText), { context });
      expect(applyPatch(p, oldText)).toBe(newText);
    }
  });

  it("respects a custom context size", () => {
    const base = Array.from({ length: 10 }, (_, i) => `l${i}`);
    const changed = base.map((l) => (l === "l5" ? "L5" : l));
    const p = computePatch("f", "modified", text(...base), text(...changed), { context: 0 });
    expect(formatPatch(p)).toBe("--- a/f\n+++ b/f\n@@ -6 +6 @@\n-l5\n+L5\n");
  });

  it("summarises totals", () => {
    const p1 = computePatch("a", "added", null, text("x", "y"));
    const p2 = computePatch("b", "deleted", text("z"), null);
    expect(formatPatchSummary([p1, p2])).toBe("2 files changed, 2 insertions(+), 1 deletion(-)");
    expect(formatPatchSummary([p1])).toBe("1 file changed, 2 insertions(+)");
  });
});

describe("AgentVCS.diffPatch", () => {
  async function makeRepo() {
    const root = await mkdtemp(path.join(tmpdir(), "avc-patch-"));
    const avc = new AgentVCS(root);
    await avc.init();
    return { root, avc };
  }

  it("diffs a checkpoint against the working tree with line detail", async () => {
    const { root, avc } = await makeRepo();
    await writeFile(path.join(root, "app.ts"), "const a = 1;\nconst b = 2;\n");
    await writeFile(path.join(root, "gone.txt"), "bye\n");
    const cp = await avc.save({ message: "base" });

    await writeFile(path.join(root, "app.ts"), "const a = 1;\nconst b = 3;\n");
    await writeFile(path.join(root, "new.txt"), "hi\n");
    await rm(path.join(root, "gone.txt"));

    const patches = await avc.diffPatch(cp.id, "work");
    expect(patches.map((p) => `${p.status}:${p.path}`)).toEqual([
      "modified:app.ts",
      "deleted:gone.txt",
      "added:new.txt",
    ]);
    expect(formatPatch(patches[0]!)).toBe(
      "--- a/app.ts\n+++ b/app.ts\n@@ -1,2 +1,2 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n"
    );
    expect(formatPatch(patches[1]!)).toBe("--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n");
    expect(formatPatch(patches[2]!)).toBe("--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+hi\n");
  });

  it("diffs two checkpoints in either direction", async () => {
    const { root, avc } = await makeRepo();
    await writeFile(path.join(root, "f.txt"), "one\n");
    const cp1 = await avc.save({ message: "one" });
    await writeFile(path.join(root, "f.txt"), "two\n");
    const cp2 = await avc.save({ message: "two" });

    const forward = await avc.diffPatch(cp1.id, cp2.id);
    expect(forward[0]?.hunks[0]?.lines).toEqual([
      { kind: "del", text: "one\n" },
      { kind: "add", text: "two\n" },
    ]);
    const backward = await avc.diffPatch(cp2.id, cp1.id);
    expect(backward[0]?.hunks[0]?.lines).toEqual([
      { kind: "del", text: "two\n" },
      { kind: "add", text: "one\n" },
    ]);
  });

  it("returns an empty list when nothing changed", async () => {
    const { root, avc } = await makeRepo();
    await writeFile(path.join(root, "f.txt"), "same\n");
    await avc.save({ message: "base" });
    await expect(avc.diffPatch("HEAD", "work")).resolves.toEqual([]);
  });
});
