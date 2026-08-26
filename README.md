# agentvc

[![CI](https://github.com/nintechio/agentvc/actions/workflows/ci.yml/badge.svg)](https://github.com/nintechio/agentvc/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/agentvc.svg)](https://www.npmjs.com/package/agentvc)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Version control for AI coding agents.** Checkpoint, branch, diff, and roll back agent sessions mid-task — from the CLI or natively via MCP (Model Context Protocol).

Git was built for humans committing at human pace. Agents mutate your workspace at machine pace, take wrong turns, delete files, and go off the rails. `agentvc` gives every agent session a **time machine**: snapshot before risky moves, fork parallel attempts onto branches, and restore any previous state in milliseconds — with **zero data loss by design**.

```
$ avc status
On branch main @ 3f9c2a1e8b04
 M src/auth.ts
 A src/auth.test.ts

$ avc save -m "auth working, pre-refactor"
Saved 7d1e44b0c2aa on main (2 file changes)
  "auth working, pre-refactor"

$ # ... agent refactors everything and breaks it ...

$ avc rollback HEAD^        # or just: avc rollback <id-prefix>
Rolled back to 7d1e44b0c2aa (12 restored, 3 removed) — HEAD stays on main
pre-rollback state saved as safety checkpoint 91ab77fe00d1
```

## Why not just git?

| | git | agentvc |
|---|---|---|
| Designed for | human commits | machine-speed agent steps |
| Staging / add -A dance | required | never — one command snapshots everything |
| Rollback safety | checkout can destroy uncommitted work | auto safety-checkpoint before every restore |
| Branch for "try another approach" | heavyweight, easy to tangle | one tool call, agents do it themselves |
| Agent-native interface | none | first-class [MCP server](#give-your-agent-the-time-machine) + library |
| Metadata per step | manual notes | structured JSON (`task`, `attempt`, tokens, model...) |

agentvc doesn't replace git for shipping code. It sits *underneath* the agent loop: cheap, safe, disposable history you can rewind freely without polluting git log.

## Install

Requires Node.js 20+.

```bash
npm install -g agentvc
```

Or use it without installing:

```bash
npx agentvc init
```

## Quickstart

```bash
mkdir demo && cd demo
avc init

echo "v1" > app.txt
avc save -m "initial state"

echo "v2" > app.txt
avc branch experiment          # fork a parallel attempt
avc switch experiment
echo "v2-experiment" > app.txt
avc save -m "risky idea"

avc timeline                   # see every attempt side by side
avc switch main                # back to safety — dirty work is auto-saved first
avc rollback HEAD              # restore files to last checkpoint anytime
avc diff                       # what changed vs the last checkpoint?
```

## Give your agent the time machine

Register the bundled MCP server with your coding agent once, and it can checkpoint and roll back itself:

```bash
claude mcp add agentvc -- avc mcp
```

Or in `.mcp.json` / Cursor / Codex / any MCP client config:

```json
{
  "mcpServers": {
    "agentvc": { "command": "avc", "args": ["mcp"] }
  }
}
```

Set `AVC_ROOT` to pin the workspace root when the server shouldn't use its cwd.

Then teach your agent *when* to use it by adding this to `AGENTS.md` / `CLAUDE.md`:

```markdown
## Session checkpoints (agentvc)

- Before any risky operation (refactors, deletions, dependency upgrades,
  schema changes), call `avc_save` with a short message.
- After reaching a working state, call `avc_save` again.
- If an approach fails twice, call `avc_rollback` to the last good checkpoint
  and try a different plan — optionally on a new branch via `avc_branch`.
- Never leave more than ~15 minutes of work unchecked.
```

### MCP tools

| Tool | Purpose |
|---|---|
| `avc_save` | Snapshot the whole workspace (call before risky ops) |
| `avc_status` | Unsaved changes vs last checkpoint |
| `avc_log` | Recent checkpoints on current branch |
| `avc_branch` / `avc_switch` | Fork alternative attempts; move between them |
| `avc_rollback` | Restore files to any checkpoint (auto-safety-checkpointed) |
| `avc_diff` | File-level changes between two points in time |
| `avc_timeline` | All checkpoints across all branches |

## Library usage

```ts
import { AgentVCS } from "agentvc";

const avc = new AgentVCS(projectRoot);
await avc.ensureInit();

const cp = await avc.save({ message: "before migration", meta: { task: "upgrade-db", step: 2 } });

if ((await avc.status()).clean) console.log("all checkpointed");

await avc.branch("plan-b");
await avc.switch("plan-b");      // via checkout()
const broken = await avc.diff("HEAD", "work");
await avc.rollback(cp.id);       // instant undo, nothing lost
```

## How it works

Content-addressed storage under `.avc/` — no daemon, no cloud, no lock-in:

```
.avc/
├── objects/ab/c3ef...     blobs & trees, deduplicated by SHA-256
├── checkpoints/           commit metadata (parents, tree, message, meta)
├── refs/heads/main        branch tips
└── index.json             id -> summary for fast prefix lookups
```

- Identical file content is stored exactly once, across all checkpoints and branches.
- Unchanged files are never rewritten on restore.
- Delete the `.avc/` folder and your workspace is untouched.
- Respects your existing `.gitignore`.

**Safety model:** every `rollback` and `switch` first snapshots unsaved changes into an automatic *safety checkpoint*. Rolling back is itself reversible — there is no way to lose work through agentvc.

## CLI reference

| Command | Description |
|---|---|
| `avc init` | Initialize a repository |
| `avc save [-m msg] [--meta json]` | Checkpoint the workspace |
| `avc status` | Show unsaved changes |
| `avc log [-n N]` | Recent checkpoints |
| `avc branch [name] [start]` | Create / list branches |
| `avc switch <branch>` | Move to a branch (restores files) |
| `avc rollback [ref]` | Restore files to a checkpoint |
| `avc diff [from] [to]` | Compare refs or working tree |
| `avc timeline` | Every checkpoint, every branch |
| `avc mcp` | Start the MCP stdio server |

## Roadmap

- [ ] Line-level diffs in terminal (`avc diff -p`)
- [ ] Merge branches (fast-forward today; 3-way next)
- [ ] Session tagging & named milestones
- [ ] Multi-agent coordination: two agents, same repo, different branches
- [ ] Hook system: auto-save on file watcher / after each agent turn
- [ ] Python SDK + MCP server parity
- [ ] Remote backup of checkpoint store

Contributions very welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © agentvc contributors
