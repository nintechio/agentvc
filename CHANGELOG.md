# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Line-level diffs** — `avc diff -p` (with `-U <n>` for context) prints
  unified diffs per changed file, coloured in the terminal and pipeable into
  `patch -p1` / `git apply`. Added and deleted files use `/dev/null` headers,
  and a missing trailing newline is marked the way `diff` does.
- `avc_diff` MCP tool accepts `patch: true` (and optional `context`) so agents
  can inspect exactly which lines changed before deciding to roll back; very
  large outputs are truncated per file with a note.
- Library: `AgentVCS.diffPatch()`, `computePatch()`, `diffLines()`,
  `formatPatch()`, `formatPatchSummary()` and the `FilePatch` / `Hunk` types.
  The engine trims common prefix/suffix then runs Myers' O(ND) diff; binary
  files, files over 2 MB / 50k lines, and rewrites beyond a 2,000-edit cap
  degrade gracefully (`limit` field) instead of blowing up.

## [0.1.0] - 2026-08-26

Initial public release.

### Added

- **Core checkpoint engine** — content-addressed store (`.avc/objects`) with
  SHA-256 deduplicated blobs and trees, checkpoint metadata with parents and
  structured `meta`, branch refs, and a fast id → summary index.
- **Automatic safety checkpoints** — `rollback` and `switch` snapshot unsaved
  changes before restoring, making every restore reversible.
- **CLI (`avc`)** — `init`, `save`, `status`, `log`, `branch`, `switch`,
  `rollback`, `diff`, `timeline`, `mcp`.
- **MCP server (`avc mcp`)** — eight tools (`avc_save`, `avc_status`,
  `avc_log`, `avc_branch`, `avc_switch`, `avc_rollback`, `avc_diff`,
  `avc_timeline`) so MCP clients such as Claude Code, Cursor, and Codex can
  checkpoint and recover autonomously.
- **TypeScript library** — `AgentVCS` class plus exported types and
  `diffTrees` helper.
- Ref resolution by `HEAD`, branch name, full checkpoint id, or unique prefix.
- `.gitignore` / `.avcignore` support, with `.git/` and `node_modules/` skipped
  by default.

[Unreleased]: https://github.com/nintechio/agentvc/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nintechio/agentvc/releases/tag/v0.1.0
