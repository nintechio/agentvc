#!/usr/bin/env node
import { Command } from "commander";
import { promises as fs } from "node:fs";
import path from "node:path";
import { AgentVCS, AvcError } from "./core/repo.js";
import type { FileDiff } from "./core/diff.js";

const VERSION = "0.1.0";
const COLORS = process.stdout.isTTY && !process.env.NO_COLOR;

function paint(code: string, s: string | number): string {
  return COLORS ? `\x1b[${code}m${String(s)}\x1b[0m` : String(s);
}
const bold = (s: string | number) => paint("1", s);
const dim = (s: string | number) => paint("2", s);
const red = (s: string | number) => paint("31", s);
const green = (s: string | number) => paint("32", s);
const yellow = (s: string | number) => paint("33", s);
const cyan = (s: string | number) => paint("36", s);

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(1, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

async function findRoot(start: string): Promise<string> {
  let cur = start;
  for (;;) {
    try {
      await fs.access(path.join(cur, ".avc"));
      return cur;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(cur);
    if (parent === cur) return start;
    cur = parent;
  }
}

async function repo(cwd = process.cwd()): Promise<AgentVCS> {
  return new AgentVCS(await findRoot(cwd));
}

function printDiffs(diffs: FileDiff[]): void {
  for (const d of diffs) {
    const mark =
      d.status === "added" ? green("A") : d.status === "deleted" ? red("D") : yellow("M");
    console.log(` ${mark} ${d.path}`);
  }
}

const program = new Command();

program
  .name("avc")
  .description("Version control for AI agent sessions — checkpoint, branch, diff and roll back agent work mid-task.")
  .version(VERSION);

program
  .command("init")
  .description("initialize agent-vcs in the current directory")
  .action(async () => {
    const avc = new AgentVCS(process.cwd());
    await avc.init();
    console.log(`${green("Initialized")} empty repository in ${dim(path.join(process.cwd(), ".avc"))}`);
  });

program
  .command("save")
  .description("create a checkpoint of the entire workspace")
  .option("-m, --message <msg>", "checkpoint message")
  .option("--meta <json>", "structured metadata, e.g. '{\"task\":\"fix-auth\",\"step\":3}'")
  .action(async (opts: { message?: string; meta?: string }) => {
    const avc = await repo();
    let meta: Record<string, unknown> = {};
    if (opts.meta) {
      try {
        meta = JSON.parse(opts.meta) as Record<string, unknown>;
      } catch {
        throw new AvcError("--meta must be valid JSON");
      }
    }
    const before = await avc.status();
    const cp = await avc.save({
      message: opts.message ?? `checkpoint @ ${new Date().toLocaleString()}`,
      meta,
    });
    const changes = before.added.length + before.modified.length + before.deleted.length;
    console.log(
      `${green("Saved")} ${bold(cp.id)} on ${cyan(cp.branch)} ${dim(`(${changes} file change${changes === 1 ? "" : "s"}, ${Object.keys(before).length ? "" : ""}${timeAgo(new Date().toISOString()).replace(" ago", "")} ago)`)}`
    );
    console.log(dim(`  "${cp.message}"`));
  });

program
  .command("status")
  .description("show unsaved changes since the last checkpoint")
  .action(async () => {
    const avc = await repo();
    const st = await avc.status();
    console.log(
      `On branch ${cyan(st.branch)}${st.head ? dim(` @ ${st.head}`) : dim(" (no checkpoints yet)")}`
    );
    if (st.clean) {
      console.log(green("Working tree clean"));
      return;
    }
    for (const p of st.added) console.log(` ${green("A")} ${p}`);
    for (const p of st.modified) console.log(` ${yellow("M")} ${p}`);
    for (const p of st.deleted) console.log(` ${red("D")} ${p}`);
    console.log(
      dim(
        `\n${st.added.length + st.modified.length + st.deleted.length} unsaved change(s) — run 'avc save -m "..."' to checkpoint`
      )
    );
  });

program
  .command("log")
  .description("list checkpoints on the current branch")
  .option("-n, --limit <n>", "number of checkpoints", "20")
  .action(async (opts: { limit: string }) => {
    const avc = await repo();
    const cps = await avc.log(parseInt(opts.limit, 10) || 20);
    if (!cps.length) {
      console.log(dim("no checkpoints yet — run 'avc save -m \"...\"'"));
      return;
    }
    cps.forEach((cp, i) => {
      const head = i === 0 ? cyan(" (HEAD)") : "";
      console.log(`${yellow(cp.id)}${head} ${dim(timeAgo(cp.timestamp))} ${cp.message}`);
      const metaKeys = Object.keys(cp.meta);
      if (metaKeys.length) console.log(dim(`         meta: ${JSON.stringify(cp.meta)}`));
    });
  });

program
  .command("branch")
  .description("create a branch, or list all branches when no name is given")
  .argument("[name]", "new branch name")
  .argument("[start]", "ref to branch from (checkpoint id or branch name)")
  .action(async (name?: string, start?: string) => {
    const avc = await repo();
    if (!name) {
      const branches = await avc.listBranches();
      for (const b of branches) {
        const marker = b.current ? cyan("*") : " ";
        const tip = b.tip ? yellow(b.tip.slice(0, 12)) : dim("(empty)");
        const msg = b.message ? dim(b.message) : "";
        const ago = b.timestamp ? dim(timeAgo(b.timestamp)) : "";
        console.log(`${marker} ${bold(b.name.padEnd(16))} ${tip} ${ago} ${msg}`);
      }
      return;
    }
    const created = await avc.branch(name, start);
    console.log(
      `${green("Created")} branch ${cyan(created.name)}${created.at ? dim(` at ${created.at}`) : ""}`
    );
  });

program
  .command("switch")
  .alias("checkout")
  .description("switch to another branch, restoring its files")
  .argument("<branch>")
  .action(async (branch: string) => {
    const avc = await repo();
    const r = await avc.checkout(branch);
    console.log(`${green("Switched")} to branch ${cyan(r.branch)} ${dim(`(${r.restored} restored, ${r.deleted} removed)`)}`);
    if (r.safetyCheckpoint) {
      console.log(dim(`unsaved work saved as safety checkpoint ${r.safetyCheckpoint.id}`));
    }
  });

program
  .command("rollback")
  .description("restore all files to a previous checkpoint (HEAD by default)")
  .argument("[ref]", "checkpoint id/prefix or branch name")
  .action(async (ref?: string) => {
    const avc = await repo();
    const r = await avc.rollback(ref ?? "HEAD");
    console.log(
      `${green("Rolled back")} to ${yellow(r.checkpoint ?? "?")} ${dim(`(${r.restored} restored, ${r.deleted} removed) — HEAD stays on ${cyan(r.branch)}`)}`
    );
    if (r.safetyCheckpoint) {
      console.log(dim(`pre-rollback state saved as safety checkpoint ${r.safetyCheckpoint.id}`));
    }
  });

program
  .command("diff")
  .description("compare two points in time (defaults: last checkpoint -> working tree)")
  .argument("[from]", "ref or 'work'")
  .argument("[to]", "ref or 'work'")
  .action(async (from?: string, to?: string) => {
    const avc = await repo();
    const diffs = await avc.diff(from ?? "HEAD", to ?? "work");
    if (!diffs.length) {
      console.log(dim("no differences"));
      return;
    }
    printDiffs(diffs);
    console.log(dim(`\n${diffs.length} file(s) changed`));
  });

program
  .command("timeline")
  .description("overview of every checkpoint across all branches")
  .action(async () => {
    const avc = await repo();
    const entries = await avc.timeline();
    if (!entries.length) {
      console.log(dim("nothing yet — run 'avc save'"));
      return;
    }
    for (const e of entries) {
      const tags = e.branches.map((b) => (e.current ? cyan(b) : dim(b))).join(", ");
      console.log(`* ${yellow(e.id)}  [${tags}]  ${dim(timeAgo(e.timestamp))}  ${e.message}`);
    }
  });

program
  .command("mcp")
  .description("start the Model Context Protocol server (stdio)")
  .action(async () => {
    const { startMcp } = await import("./mcp.js");
    await startMcp();
  });

program.parseAsync(["node", "avc", ...process.argv.slice(2)]).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(red(`error: ${msg}`));
  process.exit(1);
});
