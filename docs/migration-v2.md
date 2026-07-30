# v1 to v2 migration

Use `timezone` for calendar ranges and read the resolved range returned by the server. Replace client-side aggregation with `GET /api/dashboard`. Session list responses no longer contain full event arrays; request `GET /api/sessions/:sessionKey` when opening detail. `GET /api/summary` remains temporarily for v1 compatibility and is deprecated.
