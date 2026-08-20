# API v2

`GET /api/providers` lists Codex and Claude availability without local paths. Dashboard, session, detail, export, diagnostics, refresh, pricing refresh, and deprecated summary routes accept `provider=codex|claude`; omission selects Codex. Unknown providers return `INVALID_PROVIDER`, and a missing sessions root returns `PROVIDER_UNAVAILABLE` without stopping the server.

Dashboard and session-list requests share range, timezone, search, sorting, pagination, and filters, including `executionType=main|subagent`. Their session rows are summaries only. `GET /api/sessions/:sessionKey` loads bounded, redacted observations on demand. Session keys include provider identity and cannot cross provider boundaries.

Errors use `{ "error": { "code", "message", "requestId" } }`. `POST /api/refresh` requires same-origin `Origin` and refreshes only the selected provider; exports are provider-labelled, redacted, and CSV-safe.
