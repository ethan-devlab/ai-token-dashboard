# API v2

Dashboard and session-list requests share range, timezone, search, sorting, pagination, and filters. Their session rows are summaries only. `GET /api/sessions/:sessionKey` loads bounded, redacted observations on demand.

Errors use `{ "error": { "code", "message", "requestId" } }`. `POST /api/refresh` requires same-origin `Origin`; exports are redacted and CSV-safe.
