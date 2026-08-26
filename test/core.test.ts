import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentVCS, AvcError, diffTrees } from "../src/index.js";

async function makeRepo() {
  const root = await mkdtemp(path.join(tmpdir(), "avc-test-"));
  return { root, avc: new AgentVCS(root) };
}

describe("init", () => {
  it("creates .avc structure", async () => {
    const { root, avc } = await makeRepo();
    await avc.init();
    await expect(avc.exists()).resolves.toBe(true);
    await expect(readFile(path.join(root, ".avc", "HEAD"), "utf8")).resolves.toBe("ref: heads/main\n");
  });

  it("throws on double init", async () => {
    const { avc } = await makeRepo();
    await avc.init();
    await expect(avc.init()).rejects.toThrow(AvcError);
  });

  it("requires init for other commands", async () => {
    const { avc } = await makeRepo();
    await expect(avc.status()).rejects.toThrow(AvcError);
  });
});

describe("save / status / log", () => {
  it("saves a checkpoint and reports clean status afterwards", async () => {
    const { avc } = await makeRepo();
    await avc.init();
    await writeFile(path.join(avc.root, "a.txt"), "hello");
    const st = await avc.status();
    expect(st.added).toContain("a.txt");
    expect(st.clean).toBe(false);

    const cp = await avc.save({ message: "first" });
    expect(cp.id).toMatch(/^[0-9a-f]{16}$/);
    expect(cp.branch).toBe("main");

    const st2 = await avc.status();
    expect(st2.clean).toBe(true);
    expect(st2.head).toBe(cp.id);

    const log = await avc.log();
    expect(log).toHaveLength(1);
    expect(log[0].message).toBe("first");
  });

  it("chains parent checkpoints", async () => {
    const { avc } = await makeRepo();
    await avc.init();
    const cp1 = await avc.save({ message: "one" });
    const cp2 = await avc.save({ message: "two" });
    const log = await avc.log();
    expect(log.map((c) => c.id)).toEqual([cp2.id, cp1.id]);
    expect(log[0].parents).toEqual([cp1.id]);
  });

  it("ignores .avc, node_modules and gitignored paths", async () => {
    const { avc } = await makeRepo();
    await avc.init();
    await mkdir(path.join(avc.root, "node_modules", "pkg"), { recursive: true });
    await writeFile(path.join(avc.root, "node_modules", "pkg", "x.js"), "junk");
    await writeFile(path.join(avc.root, "secret.key"), "k");
    await writeFile(path.join(avc.root, ".gitignore"), "*.key\n");
    const st = await avc.status();
    expect(st.added).toEqual([".gitignore"]);
  });
});

describe("rollback", () => {
  it("restores deleted files and auto-saves a safety checkpoint", async () => {
    const { avc } = await makeRepo();
    await avc.init();
    await writeFile(path.join(avc.root, "app.ts"), "v1");
    await avc.save({ message: "good state" });

    await rm(path.join(avc.root, "app.ts"));
    const r = await avc.rollback("HEAD");
    expect(r.checkpoint).not.toBeNull();

    await expect(readFile(path.join(avc.root, "app.ts"), "utf8")).resolves.toBe("v1");
    const log = await avc.log();
    expect(log[0].message).toContain("safety checkpoint");
    expect(log[0].meta.auto).toBe(true);
    expect(log[1].message).toBe("good state");
  });

  it("restores modified file contents", async () => {
    const { avc } = await makeRepo();
    await avc.init();
    await writeFile(path.join(avc.root, "cfg.json"), "{}");
    await avc.save({ message: "before" });
    await writeFile(path.join(avc.root, "cfg.json"), "{ broken");
    await avc.rollback("HEAD");
    await expect(readFile(path.join(avc.root, "cfg.json"), "utf8")).resolves.toBe("{}");
  });

  it("rolls back to an older checkpoint via prefix", async () => {
    const { avc } = await makeRepo();
    await avc.init();
    await writeFile(path.join(avc.root, "f.txt"), "one");
    const cp1 = await avc.save({ message: "one" });
    await writeFile(path.join(avc.root, "f.txt"), "two");
    await avc.save({ message: "two" });

    await avc.rollback(cp1.id.slice(0, 6));
    await expect(readFile(path.join(avc.root, "f.txt"), "utf8")).resolves.toBe("one");
  });
});

describe("branches", () => {
  it("branch, diverge, switch back", async () => {
    const { avc } = await makeRepo();
    await avc.init();
    await writeFile(path.join(avc.root, "plan.md"), "approach-a");
    await avc.save({ message: "start" });

    await avc.branch("experiment");
    await avc.checkout("experiment");
    await writeFile(path.join(avc.root, "plan.md"), "approach-b");
    await avc.save({ message: "b attempt" });
    await expect(readFile(path.join(avc.root, "plan.md"), "utf8")).resolves.toBe("approach-b");

    await avc.checkout("main");
    await expect(readFile(path.join(avc.root, "plan.md"), "utf8")).resolves.toBe("approach-a");

    const branches = await avc.listBranches();
    expect(branches.map((b) => b.name).sort()).toEqual(["experiment", "main"]);
    expect(branches.find((b) => b.name === "main")?.current).toBe(true);
  });

  it("auto-saves dirty work before switching", async () => {
    const { avc } = await makeRepo();
    await avc.init();
    await writeFile(path.join(avc.root, "wip.txt"), "unsaved genius");
    await avc.save({ message: "base" });
    await writeFile(path.join(avc.root, "wip.txt"), "dirty change");

    await avc.branch("side");
    const r = await avc.checkout("side");
    expect(r.safetyCheckpoint).not.toBeNull();
    await expect(readFile(path.join(avc.root, "wip.txt"), "utf8")).resolves.toBe("unsaved genius");

    await avc.checkout("main");
    const log = await avc.log();
    expect(log[0].message).toContain("safety");
    await expect(readFile(path.join(avc.root, "wip.txt"), "utf8")).resolves.toBe("dirty change");
  });

  it("refuses unknown branches on checkout", async () => {
    const { avc } = await makeRepo();
    await avc.init();
    await expect(avc.checkout("nope")).rejects.toThrow(/not a branch/);
  });
});

describe("diff", () => {
  it("detects added, modified and deleted between checkpoints and working tree", async () => {
    const { avc } = await makeRepo();
    await avc.init();
    await writeFile(path.join(avc.root, "a.txt"), "x");
    const cp1 = await avc.save({ message: "cp1" });

    await writeFile(path.join(avc.root, "a.txt"), "y");
    await writeFile(path.join(avc.root, "b.txt"), "new");
    const cp2 = await avc.save({ message: "cp2" });

    const d = await avc.diff(cp1.id, cp2.id);
    expect(d).toEqual([
      { path: "a.txt", status: "modified" },
      { path: "b.txt", status: "added" },
    ]);

    await rm(path.join(avc.root, "b.txt"));
    const d2 = await avc.diff("HEAD", "work");
    expect(d2).toEqual([{ path: "b.txt", status: "deleted" }]);
  });
});

describe("resolveRef", () => {
  it("resolves HEAD, branch names, ids and unique prefixes", async () => {
    const { avc } = await makeRepo();
    await avc.init();
    const cp1 = await avc.save({ message: "one" });
    await avc.save({ message: "two" });

    await expect(avc.resolveRef("HEAD")).resolves.not.toBe(cp1.id);
    await expect(avc.resolveRef(cp1.id)).resolves.toBe(cp1.id);
    await expect(avc.resolveRef(cp1.id.slice(0, 8))).resolves.toBe(cp1.id);
    await expect(avc.resolveRef("nope")).rejects.toThrow(AvcError);
    await expect(avc.resolveRef("zzzzzzzz")).rejects.toThrow(AvcError);
  });
});

describe("timeline", () => {
  it("merges history across branches with branch tags", async () => {
    const { avc } = await makeRepo();
    await avc.init();
    const cpBase = await avc.save({ message: "base" });
    await avc.branch("alt");
    await avc.checkout("alt");
    await avc.save({ message: "alt try" });
    await avc.checkout("main");
    await avc.save({ message: "main try" });

    const tl = await avc.timeline();
    const base = tl.find((e) => e.id === cpBase.id)!;
    expect(base.branches.sort()).toEqual(["alt", "main"]);
    expect(tl.some((e) => e.message === "alt try" && e.branches.includes("alt"))).toBe(true);
    expect(tl.filter((e) => e.current).every((e) => e.branches.includes("main"))).toBe(true);
  });
});

describe("diffTrees unit", () => {
  it("sorts output by path", () => {
    const result = diffTrees(
      { "z.txt": { hash: "h", size: 1 }, "del.txt": { hash: "h", size: 1 } },
      { "z.txt": { hash: "changed", size: 1 }, "a.txt": { hash: "h", size: 1 } }
    );
    expect(result.map((d) => `${d.status}:${d.path}`)).toEqual([
      "added:a.txt",
      "deleted:del.txt",
      "modified:z.txt",
    ]);
  });
});
