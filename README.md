# Local AI Token Dashboard

Desktop-local Node.js dashboard for Codex and Claude Code JSONL usage. The server uses Node.js built-ins; charts use a local, pinned uPlot 1.6.32 asset. v2.1 adds provider-isolated parsers, snapshots, pricing, filters, budgets, refresh state, and exports. Use the header dropdown to switch providers without rescanning an existing snapshot.

## Run

Copy `.env.example` to `.env`, configure the local session directory if needed, then run:

```powershell
npm start
```

Open `http://localhost:3333`. The dashboard is desktop-only and keeps session data in the local server process.

## Charts

Select a single metric, stacked Token/cost plots, or dual axes; use bars or unsmoothed lines. The dashboard retains existing view preferences and saves the new layout and mark choices locally. Pointer movement shows a compact preview. Click a bucket to pin its complete values, or use Left/Right/Home/End and Enter. The data table exposes the same amounts and cost qualifiers.

Drag across complete buckets or use the start/end boundary selects. **Zoom** changes only the plot. **Apply** updates the local usage query, URL, KPIs, model list, sessions, and export scope. Account quota retains its own service period. **Return** restores the prior query during the same page session. Reload preserves the current exact interval, including DST offsets, but clears the Return history. Editing the query clears the chart interval and zoom; view changes preserve them.

All chart assets are served locally. See the [MIT license](public/scripts/vendor/uplot-LICENSE.txt) and the [archived engine comparison](docs/chart-engine-comparison.md).

The overview uses short costs and optional exact values. Partial amounts remain lower bounds. A compact account-quota strip below the KPIs shows the service's remaining quota, reset times, and check time. Expand it for complete quota details and source information. Session rows scroll within a bounded table; its header and paging remain available. Failed queries mark the retained data's original scope and provide **Retry** and **Return to displayed query**.

## Configuration

`.env` is ignored by Git. `UPDATE_REPOSITORY` is read only from this file; other launch values may be temporarily overridden through the process environment. When the dashboard is bound to a loopback host, the **Settings** link opens `/settings.html`: it validates and atomically writes only the documented `.env` keys, preserves unrelated lines, and requires a dashboard restart before saved values take effect. The settings page is disabled in remote mode.

Settings edits stay on the current page until Save succeeds. Unsaved changes are marked. Returning to the dashboard offers **Keep editing** or **Discard and return**; browser exit/reload registers its native warning while changes are unsaved. A failed save retains edits. No draft is stored in local storage.

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
| `GET /api/account-usage` | Loopback-only, cached login-plan quota windows for the selected provider. |
| `POST /api/account-usage/refresh` | Loopback-only, same-origin manual quota refresh for the selected provider. |
| `GET /api/dashboard` | Timezone-aware aggregates, comparison, quality, facets, trend/models, scan state, and first summary-only session page. |
| `GET /api/sessions` | Filtered and paged session summaries. |
| `GET /api/sessions/:sessionKey` | Lazy redacted detail with bounded accepted observations. |
| `POST /api/refresh` | The only rescan route; requires same-origin `Origin` and atomically retains the prior snapshot on failure. |
| `GET /api/export` | `csv-sessions`, `csv-trend`, `json-report`, or `markdown-summary`. |
| `GET /api/diagnostics` | Redacted process/index information; disabled in remote mode. |
| `GET /api/summary` | Deprecated v1 compatibility response. |
| `GET /api/update` | User-triggered GitHub latest stable release check. |
| `POST /api/pricing/refresh` | Same-origin manual refresh for the selected provider; not limited by the daily automatic cadence. |
| `GET /api/pricing/versions` | Provider-scoped read-only archive list; limit 1–100 and offset 0–1,000,000. |
| `GET /api/pricing/versions/:revision` | Verified complete pricing basis and observation metadata for one revision. |
| `GET /api/settings` | Loopback-only current `.env` values and revision for the settings page. |
| `POST /api/settings` | Loopback-only, same-origin, bounded JSON save with quoted `If-Match` revision; missing version returns 428, stale version returns 409; restart required. |

All dashboard, session, refresh, pricing, export, diagnostics, and deprecated summary requests accept `provider=codex|claude`; omission remains Codex-compatible. The URL provider takes precedence over the saved dropdown selection. Other query fields include `mode`, `period`, `start`, `end`, `timezone`, `q`, `sort`, `offset`, `limit`, and repeated filters, including `executionType=main|subagent`. Errors use `{ "error": { "code", "message", "requestId" } }`. List payloads never contain raw JSONL, conversation content, or full event streams.

Each provider scans lazily on first use. Range, search, filter, pagination, export, detail, and provider switching reuse the latest successful memory snapshot. **Reparse JSONL** refreshes only the selected provider and replaces that snapshot only after a successful incremental parse. Claude subagents are separate child sessions and are included by default; use the execution-type filter to exclude them.

## Privacy and pricing

Snapshots and the incremental file index are memory-only. Paths are redacted server-side by default. The settings endpoint never accepts arbitrary paths, URLs, or keys, and only writes local configuration after same-origin validation. No JSONL, local usage data, CWD, prompt, response, or session metadata is sent to GitHub, OpenAI, or Anthropic. GitHub release checking only happens after an explicit UI action.

The **Login plan usage** panel is available only on a loopback bind. The local server reads the existing Codex or Claude CLI credential file and sends only the provider-required authorization and account context to that provider's fixed official usage endpoint. Tokens, account identifiers, email addresses, and credential paths never enter browser responses, diagnostics, or logs. Results are cached for 60 seconds; **Check again** bypasses that cache. Claude OAuth credentials are refreshed and atomically rotated when required. This is a best-effort service response: unsupported or unavailable provider responses do not affect local JSONL analytics.

Codex and Claude keep independent public-price caches and refresh state. On first use, each provider checks its official pricing Markdown at most once per UTC day; **Update model prices** can refresh the selected provider at any time. A failed or invalid fetch keeps the previous valid prices. The ignored `.pricing-cache.json` and `.claude-pricing-cache.json` contain only public prices and refresh timestamps.

Costs use the current retained basis, including for historical events. Each distinct complete basis is kept under ignored `.pricing-archive/<provider>/`, without automatic deletion or an old-version switcher. JSON/Markdown exports include its rules, rates, multipliers and revision; CSV references that revision and reports archive availability. The price area links to the current verified archive and states its actual first archive time. Existing cache/bundled rates are archived on enablement; earlier unsaved versions cannot be reconstructed. New rates activate only after archive success. If the first archive fails, Token analysis remains available and cost is unknown until a valid basis can be archived. Updating prices can recover the retained basis even if the upstream request fails. This archive records estimation inputs, not official historical bills.

Claude costs are Anthropic API-equivalent token estimates, not Claude Pro or Max subscription charges. The estimate includes base input, cache read, 5-minute and 1-hour cache writes, and output when an official rule matches. It excludes web search, code execution, and other non-token tool fees. Unknown models or modifiers remain visible as partial coverage. Neither provider sends prompts, responses, tool results, CWD, or usage data to OpenAI or Anthropic.

## Updates and releases

Push a matching `vX.Y.Z` tag to create a source ZIP, `SHA256SUMS`, v2.1 migration notes, and provenance attestation. The release job uses Node.js `24.13.1`, matching the local release runtime used for this project. Verify a downloaded archive before extracting:

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
