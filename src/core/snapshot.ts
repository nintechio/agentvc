import { promises as fs } from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";

const ALWAYS_IGNORE = [".avc", ".git", "node_modules", ".DS_Store"];

export async function loadIgnoreRules(root: string): Promise<Ignore> {
  const ig = ignore();
  ig.add(ALWAYS_IGNORE);
  try {
    const raw = await fs.readFile(path.join(root, ".gitignore"), "utf8");
    ig.add(raw);
  } catch {
    try {
      const raw = await fs.readFile(path.join(root, ".avcignore"), "utf8");
      ig.add(raw);
    } catch {
      /* no ignore file */
    }
  }
  return ig;
}

export async function scanWorkspace(root: string): Promise<Map<string, Buffer>> {
  const ig = await loadIgnoreRules(root);
  const files = new Map<string, Buffer>();
  await walk(root, "", ig, files);
  return files;
}

async function walk(
  absRoot: string,
  rel: string,
  ig: Ignore,
  out: Map<string, Buffer>
): Promise<void> {
  const absDir = rel ? path.join(absRoot, rel) : absRoot;
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  for (const entry of entries) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (ig.ignores(relPath)) continue;
    if (entry.isDirectory()) {
      await walk(absRoot, relPath, ig, out);
    } else if (entry.isFile()) {
      out.set(relPath, await fs.readFile(path.join(absRoot, relPath)));
    }
  }
}
