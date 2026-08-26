import { promises as fs } from "node:fs";
import path from "node:path";
import { sha256 } from "../util/hash.js";

export class ObjectStore {
  constructor(private readonly avcDir: string) {}

  private objectPath(hash: string): string {
    return path.join(this.avcDir, "objects", hash.slice(0, 2), hash.slice(2));
  }

  async write(data: Buffer): Promise<string> {
    const hash = sha256(data);
    const p = this.objectPath(hash);
    const exists = await this.has(hash);
    if (!exists) {
      await fs.mkdir(path.dirname(p), { recursive: true });
      const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, data);
      await fs.rename(tmp, p);
    }
    return hash;
  }

  async read(hash: string): Promise<Buffer> {
    return fs.readFile(this.objectPath(hash));
  }

  async has(hash: string): Promise<boolean> {
    try {
      await fs.access(this.objectPath(hash));
      return true;
    } catch {
      return false;
    }
  }
}
