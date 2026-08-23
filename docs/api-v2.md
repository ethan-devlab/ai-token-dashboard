# API v2

`GET /api/providers` lists Codex and Claude availability without local paths. Dashboard, session, detail, export, diagnostics, refresh, pricing refresh, and deprecated summary routes accept `provider=codex|claude`; omission selects Codex. Unknown providers return `INVALID_PROVIDER`, and a missing sessions root returns `PROVIDER_UNAVAILABLE` without stopping the server.

`GET /api/account-usage` returns a loopback-only, 60-second cached view of the selected provider's login-plan quota windows. `POST /api/account-usage/refresh` requires a same-origin `Origin` and bypasses that cache. Both responses contain only normalized provider, availability reason, plan type, checked time, used/remaining percentages, window duration, and reset time. They never contain tokens, account identifiers, email addresses, or credential paths. Remote mode returns `ACCOUNT_USAGE_DISABLED`.

Dashboard and session-list requests share range, timezone, search, sorting, pagination, and filters, including `executionType=main|subagent`. Their session rows are summaries only. `GET /api/sessions/:sessionKey` loads bounded, redacted observations on demand. Session keys include provider identity and cannot cross provider boundaries.

Errors use `{ "error": { "code", "message", "requestId" } }`. `POST /api/refresh` requires same-origin `Origin` and refreshes only the selected provider; exports are provider-labelled, redacted, and CSV-safe.
