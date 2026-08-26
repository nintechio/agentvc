# Contributing to agentvc

Thanks for helping make AI agent workflows safer. This project is maintained by
[Nintech](https://nintech.io) and open to contributions from anyone.

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

```bash
git clone https://github.com/nintechio/agentvc.git
cd agentvc
npm install
npm run build
npm test
```

Useful scripts:

| Script | Purpose |
| --- | --- |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the vitest suite |

Try your local build end to end:

```bash
npm run build
mkdir /tmp/avc-play && cd /tmp/avc-play
node /path/to/agentvc/dist/cli.js init
node /path/to/agentvc/dist/cli.js save -m "hello"
```

To exercise the MCP server, point your agent client at
`node /path/to/agentvc/dist/cli.js mcp`.

## Project layout

```
src/
├── core/
│   ├── repo.ts        high-level AgentVCS API (save/status/log/branch/…)
│   ├── objects.ts     content-addressed blob + tree store (.avc/objects)
│   ├── refs.ts        branches and HEAD
│   ├── snapshot.ts    workspace scanning and ignore rules
│   ├── diff.ts        tree comparison
│   └── types.ts       shared types
├── cli.ts             human CLI (bin: avc)
├── mcp.ts             MCP stdio server (avc mcp)
└── index.ts           public library exports
test/                  vitest suite
.github/assets/        brand assets (SVG)
```

## Ground rules

1. **The safety guarantee is sacred.** No code path may destroy uncommitted
   user work without first writing a safety checkpoint. Any change touching
   `restoreTree`, `checkout`, or `rollback` needs a test proving this holds.
2. **Keep runtime dependencies minimal.** Prefer Node built-ins. New runtime
   deps need justification in the PR description.
3. **MCP tool descriptions are UX.** They must tell an agent *when* to call the
   tool, not just what it does.
4. **Types over comments.** Strict TypeScript, no `any`, self-documenting names.
5. Run `npm run typecheck && npm test` before opening a PR, and add an entry to
   `CHANGELOG.md` under `[Unreleased]`.

## Commit and PR conventions

- Write commit subjects in the imperative mood ("add merge support", not
  "added merge support").
- One logical change per PR where practical.
- Fill in the PR template, including the safety checklist.

## Reporting bugs

Open an issue using the bug report template. Include the interface (CLI, MCP,
library), your agent client, `avc --version`, Node version, and OS.

Security issues: follow [SECURITY.md](SECURITY.md) — please don't open a public
issue.

## Release process (maintainers)

1. Update `CHANGELOG.md`, moving `[Unreleased]` entries under the new version.
2. Bump the version: `npm version <patch|minor|major>`.
3. Push the tag: `git push --follow-tags`.
4. The `Release` workflow runs CI, publishes to npm with provenance, and drafts
   the GitHub release. Requires the `NPM_TOKEN` repository secret.
