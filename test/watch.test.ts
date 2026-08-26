import { describe, it, expect, vi } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentVCS, watchWorkspace } from "../src/index.js";
import type { Checkpoint } from "../src/index.js";

async function makeRepo() {
  const root = await mkdtemp(path.join(tmpdir(), "avc-watch-"));
  const avc = new AgentVCS(root);
  await avc.init();
  return { root, avc };
}

describe("saveIfDirty", () => {
  it("returns null when clean and a checkpoint when dirty", async () => {
    const { root, avc } = await makeRepo();
    await writeFile(path.join(root, "a.txt"), "1");
    const first = await avc.saveIfDirty({ message: "first" });
    expect(first?.message).toBe("first");
    await expect(avc.saveIfDirty({ message: "again" })).resolves.toBeNull();
    await writeFile(path.join(root, "a.txt"), "2");
    const second = await avc.saveIfDirty({ message: "again", meta: { auto: true } });
    expect(second?.parents).toEqual([first?.id]);
    expect((await avc.log()).map((c) => c.message)).toEqual(["again", "first"]);
  });

  it("tags safety checkpoints with a trigger", async () => {
    const { root, avc } = await makeRepo();
    await writeFile(path.join(root, "a.txt"), "1");
    await avc.save({ message: "base" });
    await writeFile(path.join(root, "a.txt"), "2");
    const r = await avc.rollback("HEAD");
    expect(r.safetyCheckpoint?.meta).toEqual({ auto: true, trigger: "safety" });
  });
});

describe("watchWorkspace", () => {
  it("auto-checkpoints after a quiet period and ignores .avc writes", async () => {
    const { root, avc } = await makeRepo();
    const saved: Checkpoint[] = [];
    const watcher = await watchWorkspace(avc, { debounceMs: 100, onCheckpoint: (cp) => saved.push(cp) });
    try {
      await mkdir(path.join(root, "src"));
      await writeFile(path.join(root, "src", "main.ts"), "console.log(1)");
      await vi.waitFor(() => expect(saved).toHaveLength(1), { timeout: 5000, interval: 25 });
      expect(saved[0]?.meta).toEqual({ auto: true, trigger: "watch" });
      expect(saved[0]?.message).toBe("auto: workspace changed");

      await new Promise((r) => setTimeout(r, 400));
      expect(saved).toHaveLength(1);
      await expect(avc.status()).resolves.toMatchObject({ clean: true });
    } finally {
      watcher.close();
    }
  });

  it("coalesces a burst of edits into one checkpoint and flush() saves pending work", async () => {
    const { root, avc } = await makeRepo();
    const saved: Checkpoint[] = [];
    const watcher = await watchWorkspace(avc, { debounceMs: 60_000, message: "auto: burst", onCheckpoint: (cp) => saved.push(cp) });
    try {
      for (let i = 0; i < 5; i++) await writeFile(path.join(root, `f${i}.txt`), String(i));
      await new Promise((r) => setTimeout(r, 200));
      expect(saved).toHaveLength(0);
      const cp = await watcher.flush();
      expect(cp?.message).toBe("auto: burst");
      expect(saved).toHaveLength(1);
      expect((await avc.log())[0]?.id).toBe(cp?.id);
      await expect(watcher.flush()).resolves.toBeNull();
    } finally {
      watcher.close();
    }
  });

  it("does not react to ignored paths", async () => {
    const { root, avc } = await makeRepo();
    await writeFile(path.join(root, ".gitignore"), "build/\n");
    await avc.save({ message: "base" });
    const saved: Checkpoint[] = [];
    const watcher = await watchWorkspace(avc, { debounceMs: 100, onCheckpoint: (cp) => saved.push(cp) });
    try {
      await mkdir(path.join(root, "build"));
      await writeFile(path.join(root, "build", "out.js"), "x");
      await new Promise((r) => setTimeout(r, 500));
      expect(saved).toHaveLength(0);
    } finally {
      watcher.close();
    }
  });
});
