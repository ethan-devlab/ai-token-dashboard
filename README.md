# Codex Token Dashboard

A dependency-free local Node.js dashboard that recursively parses Codex session JSONL files and shows token usage by time range plus an OpenAI API-equivalent cost estimate.

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

- Token units: Auto, exact integer, K, M, or B
- Optional exact values and detailed columns
- Rolling last 24 hours
- Current local day
- ISO week selector
- Month selector
- Year selector
- Custom local date/time range
- Total, input, cached input, uncached input, cache-write, output, and reasoning tokens
- Per-session and aggregate API-equivalent cost estimates
- Pricing breakdown by input, cached input, cache write, and output
- Unknown-model and incomplete-pricing warnings
- Recursive streaming JSONL parsing with no third-party dependencies
- Duplicate cumulative `token_count` snapshots are not double-counted

## Pricing caveat

The built-in table is OpenAI API **Standard** text-token pricing in USD, checked on 2026-07-26 against the official API pricing documentation. It is only an equivalent-cost estimate.

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
