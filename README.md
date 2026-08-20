# Local AI Token Dashboard

Dependency-free, desktop-local Node.js dashboard for Codex and Claude Code JSONL usage. v2.1 adds provider-isolated parsers, snapshots, pricing, filters, budgets, refresh state, and exports. Use the header dropdown to switch providers without rescanning an existing snapshot.

## Run

Copy `.env.example` to `.env`, configure the local session directory if needed, then run:

```powershell
npm start
```

Open `http://localhost:3333`. The dashboard is desktop-only and keeps session data in the local server process.

## Configuration

`.env` is ignored by Git. `UPDATE_REPOSITORY` is read only from this file; other launch values may be temporarily overridden through the process environment. When the dashboard is bound to a loopback host, the **Settings** link opens `/settings.html`: it validates and atomically writes only the documented `.env` keys, preserves unrelated lines, and requires a dashboard restart before saved values take effect. The settings page is disabled in remote mode.

| Setting | Default | Notes |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Non-loopback values require `ALLOW_REMOTE=1`; remote mode has no authentication. |
| `PORT` | `3333` | 1–65535. |
| `CODEX_SESSIONS_DIR` | platform Codex sessions path | Local JSONL root. |
| `CLAUDE_SESSIONS_DIR` | `~/.claude/projects` | Local Claude Code project JSONL root. A missing directory makes Claude unavailable without preventing server startup. |
| `MAX_FILES` | `10000` | Maximum discovered session files. |
| `PARSE_CONCURRENCY` | `min(4, availableParallelism)` | 1–16 bounded parser workers. |
| `EXPOSE_FULL_PATHS` | `0` | Only allowed with a loopback host. |
| `AUTO_REFRESH` | `0` | Uses a debounced filesystem hint; manual refresh remains available. |
| `AUTO_REFRESH_DEBOUNCE_MS` | `1500` | Coalescing delay for the optional watcher. |
| `UPDATE_REPOSITORY` | unset | Optional canonical `owner/repo` for user-triggered release checks. |

## API v2

| Endpoint | Purpose |
| --- | --- |
| `GET /api/providers` | Provider availability without exposing local paths. |
| `GET /api/dashboard` | Timezone-aware aggregates, comparison, quality, facets, trend/models, scan state, and first summary-only session page. |
| `GET /api/sessions` | Filtered and paged session summaries. |
| `GET /api/sessions/:sessionKey` | Lazy redacted detail with bounded accepted observations. |
| `POST /api/refresh` | The only rescan route; requires same-origin `Origin` and atomically retains the prior snapshot on failure. |
| `GET /api/export` | `csv-sessions`, `csv-trend`, `json-report`, or `markdown-summary`. |
| `GET /api/diagnostics` | Redacted process/index information; disabled in remote mode. |
| `GET /api/summary` | Deprecated v1 compatibility response. |
| `GET /api/update` | User-triggered GitHub latest stable release check. |
| `POST /api/pricing/refresh` | Same-origin manual refresh for the selected provider; not limited by the daily automatic cadence. |
| `GET /api/settings` | Loopback-only local `.env` values for the settings page. |
| `POST /api/settings` | Loopback-only, same-origin, bounded JSON save of validated `.env` values; restart required. |

All dashboard, session, refresh, pricing, export, diagnostics, and deprecated summary requests accept `provider=codex|claude`; omission remains Codex-compatible. The URL provider takes precedence over the saved dropdown selection. Other query fields include `mode`, `period`, `start`, `end`, `timezone`, `q`, `sort`, `offset`, `limit`, and repeated filters, including `executionType=main|subagent`. Errors use `{ "error": { "code", "message", "requestId" } }`. List payloads never contain raw JSONL, conversation content, or full event streams.

Each provider scans lazily on first use. Range, search, filter, pagination, export, detail, and provider switching reuse the latest successful memory snapshot. **Reparse JSONL** refreshes only the selected provider and replaces that snapshot only after a successful incremental parse. Claude subagents are separate child sessions and are included by default; use the execution-type filter to exclude them.

## Privacy and pricing

Snapshots and the incremental file index are memory-only. Paths are redacted server-side by default. The settings endpoint never accepts arbitrary paths, URLs, or keys, and only writes local configuration after same-origin validation. No JSONL, usage data, CWD, or session metadata is sent to GitHub or OpenAI. GitHub release checking only happens after an explicit UI action.

Codex and Claude keep independent public-price caches and refresh state. On first use, each provider checks its official pricing Markdown at most once per UTC day; **Update model prices** can refresh the selected provider at any time. A failed or invalid fetch keeps the previous valid prices. The ignored `.pricing-cache.json` and `.claude-pricing-cache.json` contain only public prices and refresh timestamps.

Claude costs are Anthropic API-equivalent token estimates, not Claude Pro or Max subscription charges. The estimate includes base input, cache read, 5-minute and 1-hour cache writes, and output when an official rule matches. It excludes web search, code execution, and other non-token tool fees. Unknown models or modifiers remain visible as partial coverage. Neither provider sends prompts, responses, tool results, CWD, or usage data to OpenAI or Anthropic.

## Updates and releases

Push a matching `vX.Y.Z` tag to create a source ZIP, `SHA256SUMS`, v2.1 migration notes, and provenance attestation. Verify a downloaded archive before extracting:

```powershell
Get-FileHash .\codex-token-dashboard-vX.Y.Z.zip -Algorithm SHA256
gh attestation verify .\codex-token-dashboard-vX.Y.Z.zip -R owner/repo
```

## Validation

```powershell
npm run check
npm run test:server
npm run test:client
npm run test:contract
```
