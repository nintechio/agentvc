# Contributing to agent-vcs

Thanks for helping make AI agent workflows safer!

## Development setup

```bash
git clone https://github.com/nintechio/agentvc.git
cd agentvc
npm install
npm run build
npm test
```

## Project layout

```
src/
├── core/
│   ├── repo.ts        high-level AgentVCS API (save/status/log/branch/...)
│   ├── objects.ts     content-addressed blob/tree store (.avc/objects)
│   ├── refs.ts        branches & HEAD
│   ├── snapshot.ts    workspace scanning + ignore rules
│   ├── diff.ts        tree comparison
│   └── types.ts       shared types
├── cli.ts             human CLI (bin: avc)
├── mcp.ts             Model Context Protocol stdio server (avc mcp)
└── index.ts           public library exports
test/                  vitest suite
```

## Ground rules

- Keep runtime dependencies minimal; prefer Node built-ins.
- The safety guarantee is sacred: no code path may destroy uncommitted user
  work without storing a safety checkpoint first. Add a test for any change
  touching `restoreTree`, `checkout`, or `rollback`.
- New MCP tools must have action-oriented descriptions that tell the agent
  *when* to call them.
- Run `npm run typecheck && npm test` before opening a PR.

## Reporting bugs

Open an issue with: agent client used (Claude Code/Cursor/Codex), steps to
reproduce, and the contents of `.avc/index.json` if relevant.
