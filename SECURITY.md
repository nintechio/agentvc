# Security Policy

## Supported versions

agentvc is pre-1.0. Security fixes land on the latest `0.x` release.

| Version | Supported |
| --- | --- |
| 0.1.x | ✅ |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via either route:

- GitHub → [Security advisories](https://github.com/nintechio/agentvc/security/advisories/new)
- Email → **admin@nintech.io** (subject: `agentvc security`)

Please include a description of the issue, reproduction steps, affected
version, and impact assessment if you have one.

**What to expect:** acknowledgement within one business day, an assessment and
remediation plan within five business days, and credit in the release notes
once a fix ships (unless you prefer to remain anonymous).

## Threat model notes

agentvc is a local-only tool. It has no network calls, no telemetry, and no
remote services. Snapshots are written to `.avc/` inside the working directory.

Security-relevant considerations we care about:

- **Secret capture** — `avc save` snapshots every non-ignored file, so files
  such as `.env` are captured unless excluded by `.gitignore`/`.avcignore`.
  Reports of ignore-rule bypasses are in scope.
- **Path traversal** — a checkpoint restoring files outside the repository root
  would be a serious bug. In scope.
- **Data loss** — any code path that destroys uncommitted work without first
  writing a safety checkpoint is treated as a security-class defect. In scope.
- **MCP surface** — the stdio server exposes filesystem-mutating tools to the
  connecting client by design. Escapes beyond `AVC_ROOT` are in scope.
