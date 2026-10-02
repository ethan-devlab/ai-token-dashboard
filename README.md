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

Month input accepts `YYYY-M` and `YYYY-MM`; the browser stores valid values as `YYYY-MM`. Model prices support name search and natural numeric version order within each naming family. This order does not indicate release dates.

With `ALLOW_REMOTE=1`, wildcard binds (`0.0.0.0` or `::`) accept the actual destination IP and configured port in the Host header. External domain names and forwarded headers do not grant access. Remote settings, diagnostics and login-plan APIs remain disabled; full paths require a loopback bind. HTTPS tunnel compatibility is not supported by this change. See [month, pricing and remote validation](docs/month-pricing-remote-validation.md).

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
| `GET /api/export` | Stream `csv-sessions`, `csv-trend`, `json-report`, or `markdown-summary`. |
| `POST /api/export/prepare` | Same-origin, guarded preparation for the displayed projection. |
| `GET /api/export/download/:ticket` | One-use native download of the prepared projection. |
| `GET /api/diagnostics` | Redacted process/index information; disabled in remote mode. |
| `GET /api/summary` | Deprecated v1 compatibility response. |
| `GET /api/update` | User-triggered GitHub latest stable release check. |
| `POST /api/pricing/refresh` | Same-origin, writer-only manual price refresh; not limited by the daily cadence. |
| `POST /api/pricing/load` | Same-origin load of the latest verified publication; available to readers and the writer. |
| `POST /api/pricing/repair` | Same-origin, writer-only repair of current pricing storage; no arbitrary path or history selection. |
| `GET /api/pricing/versions` | Provider-scoped read-only archive list; limit 1–100 and offset 0–1,000,000. |
| `GET /api/pricing/versions/:revision` | Verified complete pricing basis and observation metadata for one revision. |
| `GET /api/settings` | Loopback-only current `.env` values and revision for the settings page. |
| `POST /api/settings` | Loopback-only, same-origin, bounded JSON save with quoted `If-Match` revision; missing version returns 428, stale version returns 409; restart required. |

All dashboard, session, refresh, pricing, export, diagnostics, and deprecated summary requests accept `provider=codex|claude`; omission remains Codex-compatible. The URL provider takes precedence over the saved dropdown selection. Other query fields include `mode`, `period`, `start`, `end`, `timezone`, `q`, `sort`, `offset`, `limit`, and repeated filters, including `executionType=main|subagent`. Errors use `{ "error": { "code", "message", "requestId" } }`. List payloads never contain raw JSONL, conversation content, or full event streams.

Each provider scans lazily on first use. Range, search, filter, pagination, export, detail, and provider switching reuse the latest successful memory snapshot. **Reparse JSONL** refreshes only the selected provider and replaces that snapshot only after a successful incremental parse. Claude subagents are separate child sessions and are included by default; use the execution-type filter to exclude them.

## Downloads

Download verifies the displayed projection, then hands the file to the browser download manager. Use the browser to save or cancel. The UI does not confirm disk completion. If the data version changed, the full dashboard reloads; review it and press Download again. A transfer that already started keeps its original query, snapshot and pricing basis through later refresh or Provider changes.

Exports cover every matching Session and have no fixed 32 MiB cap. One prepared or active export is allowed per process; another request reports busy. An unused preparation expires after two minutes. The server stops transfers after 60 seconds without transport progress or 30 minutes total. Interrupted downloads restart from the Dashboard; partial files remain under browser control and Range resume is unsupported. See [the API contract](docs/api-v2.md) and [isolated performance/desktop evidence](docs/query-export-performance-validation.md).

## Privacy and pricing

Snapshots and the incremental file index are memory-only. Paths are redacted server-side by default. The settings endpoint never accepts arbitrary paths, URLs, or keys, and only writes local configuration after same-origin validation. No JSONL, local usage data, CWD, prompt, response, or session metadata is sent to GitHub, OpenAI, or Anthropic. GitHub release checking only happens after an explicit UI action.

The **Login plan usage** panel is available only on a loopback bind. The local server reads the existing Codex or Claude CLI credential file and sends only the provider-required authorization and account context to that provider's fixed official usage endpoint. Tokens, account identifiers, email addresses, and credential paths never enter browser responses, diagnostics, or logs. Results are cached for 60 seconds; **Check again** bypasses that cache. The dashboard does not refresh or write Claude credentials. When login expires or is rejected, update it in the local CLI, then check again. This is a best-effort service response: unsupported or unavailable provider responses do not affect local JSONL analytics.

One loopback dashboard process owns settings writes for this app's .env. Additional processes can analyze/export usage and read settings, but cannot save. Ownership is fixed at startup; reload does not acquire it. Stop the owning dashboard before an external .env edit, then restart. Normal Ctrl+C/SIGTERM and failed listen release ownership. An abnormal exit can leave .env.settings-lock. After confirming the former process has ended, run `node server.mjs --unlock-settings` from this app, then restart. This explicit command refuses active or uncertain ownership, has no force mode, and performs no pricing, scan or network work. Do not delete an active lock. Settings and pricing ownership are independent. See [settings ownership validation](docs/settings-ownership-validation.md).

One pricing writer per app directory owns both Provider stores, including caches, archives and check metadata. The ignored `.pricing.writer-lock/` is separate from settings ownership. Other processes do not fetch or write rates. **Load published rates** explicitly validates and loads the latest publication into the full dashboard. A failed load retains the old basis only while it remains valid. Writer access is fixed at startup; a running reader does not take over after the writer exits. Stop the writer before external pricing-file edits. After an abnormal exit, confirm that it ended, run `node server.mjs --unlock-pricing`, then restart. The command only accepts a confirmed absent owner on this machine; active, foreign, malformed or uncertain ownership is refused. It performs no price fetch or repair.

Codex and Claude keep independent public-price caches and refresh state. With valid current pricing, the writer checks each Provider's fixed official Markdown source at most once per UTC day. **Update model prices** performs an explicit refresh. A failed or invalid fetch keeps previously verified prices. Per-Provider operations run in order; attempt metadata cannot overwrite a newer basis. The ignored `.pricing-cache.json` and `.claude-pricing-cache.json` are the current publication records. Version-1 publications remain supported when their complete basis matches a valid archive.

Costs use the current retained basis, including for historical events. Each complete basis remains under ignored `.pricing-archive/<provider>/`, without automatic deletion or a history switcher. JSON/Markdown include rules, rates, multipliers and revision; CSV references the revision and availability. New rates activate after both archive and publication succeed. Each new cost response or export preparation verifies the active basis again. Invalid storage leaves Tokens available and costs unknown. Already prepared downloads keep their admitted data. Invalid check metadata makes check time unknown and adds a warning; it does not invalidate verified rates.

Only a genuinely empty Provider store is initialized with sealed and published bundled rates by the writer. Missing or damaged existing publication state does not select a historical archive. **Repair pricing archive** uses a complete basis previously verified by that process, or newly fetched and validated rates. It retains damaged files in unique quarantine files and never replaces a valid basis. An interrupted or unpublished repair keeps a `.repairing` marker next to the cache; affected costs remain unknown until an explicit writer action completes publication. Repair preserves a previously verified first archive time when available; a new source-based reconstruction uses its actual new archive time. Permanent retention also covers quarantine records. These checks cover process interruption and restart, not power-loss durability or a tamper-proof ledger. See [pricing ownership and recovery validation](docs/pricing-ownership-recovery-validation.md).

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
