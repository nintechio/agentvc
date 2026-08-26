import { promises as fs } from "node:fs";
import path from "node:path";
import { ObjectStore } from "./objects.js";
import { Refs } from "./refs.js";
import { scanWorkspace } from "./snapshot.js";
import { diffTrees } from "./diff.js";
import type { FileDiff } from "./diff.js";
import { computePatch } from "./patch.js";
import type { FilePatch, PatchOptions } from "./patch.js";
import { sha256 } from "../util/hash.js";
import type { Checkpoint, Index, IndexEntry, Tree } from "./types.js";

export interface SaveOptions {
  message: string;
  meta?: Record<string, unknown>;
}

export interface StatusResult {
  branch: string;
  head: string | null;
  added: string[];
  modified: string[];
  deleted: string[];
  clean: boolean;
}

export interface BranchInfo {
  name: string;
  tip: string | null;
  current: boolean;
  message?: string;
  timestamp?: string;
}

export interface TimelineEntry {
  id: string;
  message: string;
  timestamp: string;
  branches: string[];
  current: boolean;
  parents: string[];
}

export interface RestoreResult {
  checkpoint: string | null;
  branch: string;
  restored: number;
  deleted: number;
  safetyCheckpoint: Checkpoint | null;
}

export class AvcError extends Error {}

interface DiffSide {
  tree: Tree;
  read: (rel: string) => Promise<Buffer>;
}

export class AgentVCS {
  private readonly objects: ObjectStore;
  private readonly refs: Refs;

  constructor(readonly root: string) {
    this.objects = new ObjectStore(this.avcDir);
    this.refs = new Refs(this.avcDir);
  }

  get avcDir(): string {
    return path.join(this.root, ".avc");
  }

  async exists(): Promise<boolean> {
    try {
      await fs.access(this.avcDir);
      return true;
    } catch {
      return false;
    }
  }

  async requireInit(): Promise<void> {
    if (!(await this.exists())) {
      throw new AvcError("not an agent-vcs repository — run 'avc init' first");
    }
  }

  async ensureInit(): Promise<void> {
    if (!(await this.exists())) await this.init();
  }

  async init(initialBranch = "main"): Promise<void> {
    if (await this.exists()) throw new AvcError(`already initialized at ${this.avcDir}`);
    await fs.mkdir(path.join(this.avcDir, "objects"), { recursive: true });
    await fs.mkdir(path.join(this.avcDir, "refs", "heads"), { recursive: true });
    await fs.writeFile(path.join(this.avcDir, "HEAD"), `ref: heads/${initialBranch}\n`);
    await this.writeIndex({});
  }

  async save(opts: SaveOptions): Promise<Checkpoint> {
    await this.requireInit();
    const branch = await this.refs.currentBranch();
    const parent = await this.refs.tip(branch);
    const files = await scanWorkspace(this.root);
    const tree: Tree = {};
    for (const [rel, data] of files) {
      const hash = await this.objects.write(data);
      tree[rel] = { hash, size: data.length };
    }
    const treeHash = await this.objects.write(Buffer.from(JSON.stringify(tree), "utf8"));
    const base = {
      parents: parent ? [parent] : [],
      tree: treeHash,
      message: opts.message,
      timestamp: new Date().toISOString(),
      meta: opts.meta ?? {},
      branch,
    };
    const id = sha256(Buffer.from(JSON.stringify(base), "utf8")).slice(0, 16);
    const cp: Checkpoint = { id, ...base };
    await this.writeCheckpoint(cp);
    await this.refs.setTip(branch, id);
    await this.appendIndex(id, {
      branch,
      message: cp.message,
      timestamp: cp.timestamp,
    });
    return cp;
  }

  async saveIfDirty(opts: SaveOptions): Promise<Checkpoint | null> {
    const st = await this.status();
    if (st.clean) return null;
    return this.save(opts);
  }

  async readCheckpoint(id: string): Promise<Checkpoint> {
    try {
      const raw = await fs.readFile(this.checkpointPath(id), "utf8");
      const cp = JSON.parse(raw) as Checkpoint;
      if (typeof cp.id !== "string" || typeof cp.tree !== "string") throw new Error("bad shape");
      return cp;
    } catch {
      throw new AvcError(`corrupt or missing checkpoint '${id}'`);
    }
  }

  async status(): Promise<StatusResult> {
    await this.requireInit();
    const branch = await this.refs.currentBranch();
    const headId = await this.refs.tip(branch);
    const headTree = headId ? await this.treeOfCheckpoint(headId) : {};
    const workTree = await this.workTree();
    const diffs = diffTrees(headTree, workTree);
    return {
      branch,
      head: headId,
      added: diffs.filter((d) => d.status === "added").map((d) => d.path),
      modified: diffs.filter((d) => d.status === "modified").map((d) => d.path),
      deleted: diffs.filter((d) => d.status === "deleted").map((d) => d.path),
      clean: diffs.length === 0,
    };
  }

  async log(limit = 50): Promise<Checkpoint[]> {
    await this.requireInit();
    const branch = await this.refs.currentBranch();
    let cur = await this.refs.tip(branch);
    const out: Checkpoint[] = [];
    const seen = new Set<string>();
    while (cur && out.length < limit && !seen.has(cur)) {
      seen.add(cur);
      const cp = await this.readCheckpoint(cur);
      out.push(cp);
      cur = cp.parents[0] ?? null;
    }
    return out;
  }

  async branch(name: string, from?: string): Promise<{ name: string; at: string | null }> {
    await this.requireInit();
    if (!/^[\w][\w./-]*$/.test(name)) throw new AvcError(`invalid branch name '${name}'`);
    if ((await this.refs.listBranches()).includes(name)) {
      throw new AvcError(`branch '${name}' already exists`);
    }
    const at = from ? await this.resolveRef(from) : await this.currentTipOrNull();
    await this.refs.setTip(name, at);
    return { name, at };
  }

  async listBranches(): Promise<BranchInfo[]> {
    await this.requireInit();
    const names = await this.refs.listBranches();
    const current = await this.refs.currentBranch();
    const index = await this.readIndex();
    const out: BranchInfo[] = [];
    for (const name of names) {
      const tip = await this.refs.tip(name);
      const info: BranchInfo = { name, tip, current: name === current };
      if (tip && index[tip]) {
        info.message = index[tip].message;
        info.timestamp = index[tip].timestamp;
      }
      out.push(info);
    }
    return out;
  }

  async checkout(target: string): Promise<RestoreResult> {
    await this.requireInit();
    if (!(await this.refs.listBranches()).includes(target)) {
      throw new AvcError(
        `'${target}' is not a branch — use 'avc rollback ${target}' to restore files without switching branches`
      );
    }
    const safety = await this.autoSafetyCheckpoint("auto: safety checkpoint before checkout");
    const tipId = await this.refs.tip(target);
    let restored = 0;
    let deleted = 0;
    if (tipId) {
      const tree = await this.treeOfCheckpoint(tipId);
      ({ restored, deleted } = await this.restoreTree(tree));
    }
    await this.refs.setCurrentBranch(target);
    return { checkpoint: tipId, branch: target, restored, deleted, safetyCheckpoint: safety };
  }

  async rollback(to = "HEAD"): Promise<RestoreResult> {
    await this.requireInit();
    const id = await this.resolveRef(to);
    const safety = await this.autoSafetyCheckpoint("auto: safety checkpoint before rollback");
    const tree = await this.treeOfCheckpoint(id);
    const { restored, deleted } = await this.restoreTree(tree);
    const branch = await this.refs.currentBranch();
    return { checkpoint: id, branch, restored, deleted, safetyCheckpoint: safety };
  }

  async diff(fromRef = "HEAD", toRef = "work"): Promise<FileDiff[]> {
    await this.requireInit();
    return diffTrees(await this.treeForRef(fromRef), await this.treeForRef(toRef));
  }

  async diffPatch(fromRef = "HEAD", toRef = "work", options: PatchOptions = {}): Promise<FilePatch[]> {
    await this.requireInit();
    const from = await this.sideForRef(fromRef);
    const to = await this.sideForRef(toRef);
    const patches: FilePatch[] = [];
    for (const d of diffTrees(from.tree, to.tree)) {
      const oldData = d.status === "added" ? null : await from.read(d.path);
      const newData = d.status === "deleted" ? null : await to.read(d.path);
      patches.push(computePatch(d.path, d.status, oldData, newData, options));
    }
    return patches;
  }

  async timeline(limitPerBranch = 1000): Promise<TimelineEntry[]> {
    await this.requireInit();
    const branches = await this.refs.listBranches();
    const current = await this.refs.currentBranch();
    const map = new Map<string, { cp: Checkpoint; branches: Set<string> }>();
    for (const b of branches) {
      let cur = await this.refs.tip(b);
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        const cp = await this.readCheckpoint(cur);
        const existing = map.get(cur);
        if (existing) existing.branches.add(b);
        else map.set(cur, { cp, branches: new Set([b]) });
        cur = cp.parents[0] ?? null;
      }
    }
    return [...map.values()]
      .sort((a, b) => b.cp.timestamp.localeCompare(a.cp.timestamp))
      .slice(0, limitPerBranch)
      .map(({ cp, branches: bs }) => ({
        id: cp.id,
        message: cp.message,
        timestamp: cp.timestamp,
        parents: cp.parents,
        branches: [...bs],
        current: cp.branch === current,
      }));
  }

  async resolveRef(ref: string): Promise<string> {
    await this.requireInit();
    if (ref === "HEAD" || ref === "last") {
      const tip = await this.currentTipOrNull();
      if (!tip) throw new AvcError(`branch '${await this.refs.currentBranch()}' has no checkpoints yet`);
      return tip;
    }
    if ((await this.refs.listBranches()).includes(ref)) {
      const tip = await this.refs.tip(ref);
      if (!tip) throw new AvcError(`branch '${ref}' has no checkpoints yet`);
      return tip;
    }
    const index = await this.readIndex();
    if (index[ref]) return ref;
    if (/^[0-9a-f]{4,64}$/i.test(ref)) {
      const matches = Object.keys(index).filter((id) => id.startsWith(ref.toLowerCase()));
      if (matches.length === 1) {
        const match = matches[0];
        if (match) return match;
      } else if (matches.length > 1) throw new AvcError(`ambiguous checkpoint id '${ref}'`);
    }
    throw new AvcError(`unknown ref '${ref}'`);
  }

  private async currentTipOrNull(): Promise<string | null> {
    const b = await this.refs.currentBranch();
    return this.refs.tip(b);
  }

  private async workTree(): Promise<Tree> {
    return (await this.workSide()).tree;
  }

  private async workSide(): Promise<DiffSide> {
    const files = await scanWorkspace(this.root);
    const tree: Tree = {};
    for (const [rel, data] of files) {
      tree[rel] = { hash: sha256(data), size: data.length };
    }
    return {
      tree,
      read: async (rel) => {
        const data = files.get(rel);
        if (!data) throw new AvcError(`'${rel}' vanished from the working tree during diff`);
        return data;
      },
    };
  }

  private async checkpointSide(id: string): Promise<DiffSide> {
    const tree = await this.treeOfCheckpoint(id);
    return {
      tree,
      read: async (rel) => {
        const entry = tree[rel];
        if (!entry) throw new AvcError(`'${rel}' is not in checkpoint ${id}`);
        return this.objects.read(entry.hash);
      },
    };
  }

  private async sideForRef(ref: string): Promise<DiffSide> {
    if (ref === "work") return this.workSide();
    return this.checkpointSide(await this.resolveRef(ref));
  }

  private async treeOfCheckpoint(id: string): Promise<Tree> {
    const cp = await this.readCheckpoint(id);
    const raw = await this.objects.read(cp.tree);
    return JSON.parse(raw.toString("utf8")) as Tree;
  }

  private async treeForRef(ref: string): Promise<Tree> {
    if (ref === "work") return this.workTree();
    return this.treeOfCheckpoint(await this.resolveRef(ref));
  }

  private async autoSafetyCheckpoint(reason: string): Promise<Checkpoint | null> {
    return this.saveIfDirty({ message: reason, meta: { auto: true, trigger: "safety" } });
  }

  private async restoreTree(tree: Tree): Promise<{ restored: number; deleted: number }> {
    const current = await scanWorkspace(this.root);
    let deleted = 0;
    for (const rel of current.keys()) {
      if (!tree[rel]) {
        await fs.rm(path.join(this.root, rel), { force: true });
        deleted++;
        await this.pruneEmptyDirs(path.dirname(rel));
      }
    }
    let restored = 0;
    for (const [rel, entry] of Object.entries(tree)) {
      const cur = current.get(rel);
      if (cur && cur.length === entry.size && sha256(cur) === entry.hash) continue;
      const data = await this.objects.read(entry.hash);
      const abs = path.join(this.root, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, data);
      restored++;
    }
    return { restored, deleted };
  }

  private async pruneEmptyDirs(relDir: string): Promise<void> {
    let dir = relDir;
    while (dir && dir !== ".") {
      const abs = path.join(this.root, dir);
      try {
        const entries = await fs.readdir(abs);
        if (entries.length > 0) break;
        await fs.rmdir(abs);
      } catch {
        break;
      }
      dir = path.dirname(dir);
    }
  }

  private checkpointPath(id: string): string {
    return path.join(this.avcDir, "checkpoints", id.slice(0, 2), `${id.slice(2)}.json`);
  }

  private async writeCheckpoint(cp: Checkpoint): Promise<void> {
    const p = this.checkpointPath(cp.id);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(cp, null, 2));
  }

  private indexPath(): string {
    return path.join(this.avcDir, "index.json");
  }

  private async readIndex(): Promise<Index> {
    try {
      return JSON.parse(await fs.readFile(this.indexPath(), "utf8")) as Index;
    } catch {
      return {};
    }
  }

  private async writeIndex(index: Index): Promise<void> {
    await fs.writeFile(this.indexPath(), JSON.stringify(index, null, 2));
  }

  private async appendIndex(id: string, entry: IndexEntry): Promise<void> {
    const index = await this.readIndex();
    index[id] = entry;
    await this.writeIndex(index);
  }
}
