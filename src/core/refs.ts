import { promises as fs } from "node:fs";
import path from "node:path";

export class Refs {
  constructor(private readonly avcDir: string) {}

  private headsDir(): string {
    return path.join(this.avcDir, "refs", "heads");
  }

  async currentBranch(): Promise<string> {
    const raw = await fs.readFile(path.join(this.avcDir, "HEAD"), "utf8");
    const m = raw.trim().match(/^ref:\s*heads\/(.+)$/);
    const branch = m?.[1];
    if (!branch) throw new Error(`malformed HEAD: ${raw.trim()}`);
    return branch.trim();
  }

  async setCurrentBranch(branch: string): Promise<void> {
    await fs.writeFile(path.join(this.avcDir, "HEAD"), `ref: heads/${branch}\n`);
  }

  async listBranches(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.headsDir(), { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => e.name).sort();
    } catch {
      return [];
    }
  }

  async tip(branch: string): Promise<string | null> {
    try {
      const raw = await fs.readFile(path.join(this.headsDir(), branch), "utf8");
      const id = raw.trim();
      return id.length ? id : null;
    } catch {
      return null;
    }
  }

  async setTip(branch: string, id: string | null): Promise<void> {
    const p = path.join(this.headsDir(), branch);
    await fs.mkdir(path.dirname(p), { recursive: true });
    if (id === null) {
      await fs.rm(p, { force: true });
      return;
    }
    await fs.writeFile(p, `${id}\n`);
  }
}
