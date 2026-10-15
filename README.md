# Local AI Token Dashboard

A desktop dashboard for local Codex and Claude Code JSONL usage. Compare Tokens, API-equivalent cost, models and Sessions; check CLI login-plan quota and export filtered reports. The server uses Node.js built-ins and serves its chart assets locally.

## Start

Requires Node.js 22.15.0+ (22.x), 23.8.0+ (23.x), or 24+. No dependency installation or build is required. Codex sources can contain plain `.jsonl` files and Zstandard-compressed `.jsonl.zst` files; both are read without extracting files to disk. For v2 upgrades, read the [v3 upgrade guide](docs/migration-v3.md) for runtime and cost changes.

1. Copy `.env.example` to `.env`.
2. Adjust session directories if the CLI uses a non-default location.
3. Run `npm start`, then open [localhost:3333](http://localhost:3333).

The header shows the running Dashboard version from `package.json`. Settings saved in the UI take effect after a restart. Keep the default loopback bind for local use.

Both session directories accept `~` and `~/` paths, such as `~/.codex/sessions` and `~/.claude/projects`, on Windows, Linux, and macOS. Set `DETAIL_OBSERVATION_LIMIT=5000` in `.env` to return up to 5,000 observations in a Session detail response (default 2,000; valid range 1–100,000). This does not limit JSONL parsing or token/cost totals. Restart the server after changing `.env`.

## What to expect

- Codex and Claude have separate snapshots, filters, budgets and pricing. Claude subagent usage is included by default.
- Periods and comparisons use the selected timezone. Charts, Sessions and exports share the same filtered usage.
- Costs are public API-equivalent estimates, not subscription bills. Unknown prices and incomplete usage stay visible as quality warnings.
- Downloads include all matching Sessions across pages and use the browser download manager.
- Refresh failures retain the previous complete snapshot. Settings and pricing each have one writer; startup can recover only a verified absent local owner.

## Find the right guide

| Need | Guide |
| --- | --- |
| Use filters, charts, quota and downloads | [Dashboard guide](docs/usage.md) |
| Change directories, watching or network settings | [Configuration](docs/configuration.md) |
| Resolve read-only settings or pricing errors | [Operations and recovery](docs/operations.md) |
| Understand privacy and LAN restrictions | [Security model](docs/security.md) |
| Build an API client | [API reference](docs/api-v2.md) |
| Develop, validate or publish a release | [Development and releases](docs/development.md) |
| Review limitations or previous evidence | [Status and limits](docs/status.md) · [Historical records](docs/archive/README.md) |

[Documentation index](docs/README.md) includes architecture and migration notes. Historical plans and test records are kept in the archive; current behavior is described in the guides above.
