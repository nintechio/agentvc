#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AgentVCS } from "./core/repo.js";
import { packageVersion } from "./util/version.js";
import { formatPatch, formatPatchSummary } from "./core/patch.js";

export const VERSION = packageVersion();

function rootDir(): string {
  return process.env.AVC_ROOT ? path.resolve(process.env.AVC_ROOT) : process.cwd();
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const MAX_PATCH_OUTPUT_CHARS = 200_000;

async function withRepo<T>(fn: (avc: AgentVCS) => Promise<T>): Promise<ToolResult> {
  try {
    const avc = new AgentVCS(rootDir());
    await avc.ensureInit();
    const result = await fn(avc);
    return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `agent-vcs error: ${msg}` }],
      isError: true,
    };
  }
}

export async function startMcp(): Promise<void> {
  const server = new McpServer({ name: "agent-vcs", version: VERSION });
  const root = rootDir();

  server.registerTool(
    "avc_status",
    {
      title: "Workspace status",
      description:
        "Show unsaved changes between the workspace files and the last checkpoint (added/modified/deleted per file). Call this whenever you are unsure whether work is already checkpointed.",
      inputSchema: {},
    },
    async () => withRepo((avc) => avc.status())
  );

  server.registerTool(
    "avc_save",
    {
      title: "Create checkpoint",
      description:
        "Snapshot EVERY file in the workspace so it can be restored later. ALWAYS call this immediately BEFORE risky operations (large refactors, deletions, dependency upgrades, config changes) and immediately AFTER reaching a working state. Nothing is uploaded anywhere; data stays under ./.avc/.",
      inputSchema: {
        message: z.string().describe("Short description of what is true right now"),
        meta: z.record(z.string(), z.unknown()).optional().describe("Structured metadata, e.g. {\"task\":\"fix-auth\",\"attempt\":2}"),
        only_if_changed: z
          .boolean()
          .optional()
          .describe("Skip silently when nothing changed since the last checkpoint. Use this for routine end-of-turn checkpoints so history stays free of duplicates."),
      },
    },
    async (args) =>
      withRepo(async (avc) => {
        const opts = { message: args.message, meta: args.meta };
        const cp = args.only_if_changed ? await avc.saveIfDirty(opts) : await avc.save(opts);
        if (!cp) return "Nothing to save — the workspace already matches the last checkpoint.";
        return `Checkpoint ${cp.id} saved on branch '${cp.branch}': ${cp.message}`;
      })
  );

  server.registerTool(
    "avc_log",
    {
      title: "Recent checkpoints",
      description: "List recent checkpoints on the current branch, newest first.",
      inputSchema: {
        limit: z.number().int().positive().max(500).optional().describe("Max entries (default 20)"),
      },
    },
    async (args) => withRepo((avc) => avc.log(args?.limit ?? 20))
  );

  server.registerTool(
    "avc_branch",
    {
      title: "Create branch",
      description:
        "Create a new branch (a parallel timeline of checkpoints), optionally starting from a specific checkpoint. Use this to try an alternative approach without losing the current one.",
      inputSchema: {
        name: z.string().describe("New branch name, e.g. 'retry-with-redis'"),
        from: z.string().optional().describe("Checkpoint id/prefix or branch name to start from (default: current tip)"),
      },
    },
    async (args) =>
      withRepo(async (avc) => {
        const r = await avc.branch(args.name, args.from);
        return `Branch '${r.name}' created${r.at ? ` at checkpoint ${r.at}` : " (empty)"}`;
      })
  );

  server.registerTool(
    "avc_switch",
    {
      title: "Switch branch",
      description:
        "Switch to another branch and restore its files in the workspace. Unsaved changes are automatically preserved in a safety checkpoint first — nothing is ever lost.",
      inputSchema: { branch: z.string().describe("Existing branch name") },
    },
    async (args) =>
      withRepo(async (avc) => {
        const r = await avc.checkout(args.branch);
        return `Switched to '${r.branch}' (${r.restored} files restored, ${r.deleted} removed).${
          r.safetyCheckpoint ? ` Prior work saved as safety checkpoint ${r.safetyCheckpoint.id}.` : ""
        }`;
      })
  );

  server.registerTool(
    "avc_rollback",
    {
      title: "Rollback files",
      description:
        "Restore ALL workspace files to their state at an earlier checkpoint. Use this when the current approach has gone wrong or files were broken by recent edits. The pre-rollback state is auto-saved as a safety checkpoint first, and the current branch position does NOT move — this is safe and reversible.",
      inputSchema: {
        ref: z.string().optional().describe("'HEAD' (default), a branch name, or a checkpoint id/prefix"),
      },
    },
    async (args) =>
      withRepo(async (avc) => {
        const r = await avc.rollback(args?.ref ?? "HEAD");
        return `Files rolled back to checkpoint ${r.checkpoint} (${r.restored} restored, ${r.deleted} removed). Branch position unchanged ('${r.branch}').${
          r.safetyCheckpoint ? ` Pre-rollback state saved as safety checkpoint ${r.safetyCheckpoint.id}.` : ""
        }`;
      })
  );

  server.registerTool(
    "avc_diff",
    {
      title: "Diff two points",
      description:
        "Show which files were added/modified/deleted between two points in time. Defaults compare the last checkpoint against the live working tree. Set patch=true to see the exact line-level changes (unified diff) — use it before deciding whether to roll back, when reviewing what an approach changed, or to recover a specific edit from an older checkpoint.",
      inputSchema: {
        from: z.string().optional().describe("Ref: 'HEAD', branch name, checkpoint id/prefix, or 'work'. Default 'HEAD'."),
        to: z.string().optional().describe("Ref or 'work'. Default 'work'."),
        patch: z
          .boolean()
          .optional()
          .describe("Include line-level unified diffs of each changed file instead of just the file list. Default false."),
        context: z
          .number()
          .int()
          .min(0)
          .max(100)
          .optional()
          .describe("Lines of unchanged context around each change when patch=true. Default 3."),
      },
    },
    async (args) =>
      withRepo(async (avc) => {
        const from = args?.from ?? "HEAD";
        const to = args?.to ?? "work";
        if (args?.patch) {
          const patches = await avc.diffPatch(from, to, { context: args.context ?? 3 });
          if (!patches.length) return "No differences.";
          const chunks: string[] = [];
          let used = 0;
          let omitted = 0;
          for (const p of patches) {
            const text = formatPatch(p);
            if (used + text.length > MAX_PATCH_OUTPUT_CHARS && chunks.length) {
              omitted++;
              continue;
            }
            chunks.push(text);
            used += text.length;
          }
          if (omitted) {
            chunks.push(
              `(patch output truncated: ${omitted} more changed file(s) omitted — call avc_diff again with a narrower range or without patch)\n`
            );
          }
          chunks.push(formatPatchSummary(patches));
          return chunks.join("\n");
        }
        const diffs = await avc.diff(from, to);
        if (!diffs.length) return "No differences.";
        return diffs.map((d) => `${d.status === "added" ? "+" : d.status === "deleted" ? "-" : "~"} ${d.path}`).join("\n");
      })
  );

  server.registerTool(
    "avc_timeline",
    {
      title: "Full timeline",
      description:
        "Overview of every checkpoint across ALL branches — useful for seeing alternative attempts side by side.",
      inputSchema: {},
    },
    async () => withRepo((avc) => avc.timeline())
  );

  await server.connect(new StdioServerTransport());
  console.error(`agent-vcs MCP server v${VERSION} ready (root: ${root})`);
}

const invokedDirectly =
  !!process.argv[1] &&
  (() => {
    try {
      return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
    } catch {
      return false;
    }
  })();

if (invokedDirectly) {
  startMcp().catch((err) => {
    console.error("agent-vcs MCP server failed to start:", err);
    process.exit(1);
  });
}
