# Codex Token Dashboard

A dependency-free, desktop-local Node.js dashboard that recursively parses Codex session JSONL files and shows token usage, trends, model breakdowns, session details, and an OpenAI API-equivalent cost estimate.

It requires Node.js 18 or newer and listens on loopback by default. The dashboard is a local observability surface: it does not use a CDN, analytics, or remote application services.

## Run

```bash
npm start
```

Open:

```text
http://localhost:3333
```

Default sessions directory:

- macOS/Linux: `~/.codex/sessions`
- Windows: `C:\Users\<current-user>\.codex\sessions`

## Override the directory

macOS/Linux:

```bash
CODEX_SESSIONS_DIR=/custom/path/.codex/sessions npm start
```

PowerShell:

```powershell
$env:CODEX_SESSIONS_DIR='C:\Users\xx\.codex\sessions'
npm start
```

## Features

- Desktop-only observability console with a restrictive same-origin CSP
- Token units: Auto, exact integer, K, M, or B
- Optional exact values, detailed Explorer columns, and compact table density
- Rolling last 24 hours
- Current local day
- ISO week selector
- Month selector
- Year selector
- Custom local date/time range
- Total, input, cached input, uncached input, cache-write, output, and reasoning tokens
- Server-side range aggregation, usage trend, and model breakdown
- Server-side Session Explorer pagination (100 sessions per page by default)
- Search and sort state preserved in the URL; display preferences stored only in local storage
- Per-session detail drawer with redacted home-directory paths
- Per-session and aggregate API-equivalent cost estimates
- Pricing breakdown by input, cached input, cache write, and output
- Unknown-model and incomplete-pricing warnings
- Recursive streaming JSONL parsing with no third-party dependencies
- Duplicate cumulative `token_count` snapshots are not double-counted

## API

The browser client uses these local, read-only JSON endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/summary` | Backward-compatible complete summary response. |
| `GET /api/dashboard` | Range aggregates, trend, model data, quality facts, and the first session page. |
| `GET /api/sessions` | A subsequent filtered session page without duplicate aggregate data. |

`/api/dashboard` and `/api/sessions` accept `mode`, `from`, `to`, `search`, `sort`, `offset`, and `limit`. `mode` is one of `all`, `last24h`, `today`, `week`, `month`, `year`, or `custom`; `limit` is capped at 200. Invalid query values return `400`.

The paged endpoints return parsed session summaries and token events only. They do not return raw JSONL events or conversation content.

## Pricing caveat

The pricing table lives in `server/pricing.json`. It is OpenAI API **Standard** text-token pricing in USD, checked on 2026-07-26 against the official API pricing documentation. It is only an equivalent-cost estimate.

Actual billing may differ because Codex/ChatGPT subscriptions, service tier, regional processing, Batch/Flex/Priority, tools, enterprise discounts, and future pricing changes are not fully represented in session JSONL.

`cached_input_tokens` is treated as a subset of `input_tokens`. The estimate therefore uses:

```text
uncached input × input rate
+ cached input × cached-input rate
+ cache-write tokens × cache-write rate
+ output tokens × output rate
```

Reasoning output is normally included in output tokens, so it is not charged a second time.

## Options

```text
HOST=127.0.0.1
PORT=3333
MAX_FILES=10000
CODEX_SESSIONS_DIR=/path/to/.codex/sessions
```

## Validation

```bash
npm run check
npm run test:client
npm run test:contract
```
