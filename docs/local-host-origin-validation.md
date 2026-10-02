# Local Host and Origin implementation validation

Date: 2026-10-02 (Asia/Taipei). Approved plan: 33f1b89, Q67–Q69. This report covers isolated copied services and desktop browser checks. The formal 127.0.0.1:3333 process was not restarted or used for these checks.

## Delivered behavior

server/request-policy.mjs is the common request gate in server.mjs. It reuses the existing Host whitelist and socket-destination rule, validates single authorities and effective ports, and rejects request targets that change authority. API GET keeps absent-source and native-navigation compatibility, while explicit invalid Origin or Fetch Metadata is rejected before handlers. POST requires an exact HTTP Origin; present metadata must be same-origin. Forwarded headers grant no access. Existing remote private-route and full-path restrictions remain.

The dashboard update button now uses POST /api/update. GET returns 405 with Allow: POST and makes no GitHub request. POST rejects nonempty or chunked bodies before the update checker. The server still reads public Releases through anonymous GET. The default repository from bd040cb, custom repository precedence and explicit blank disabling remain unchanged. Direct API callers must migrate to a body-free POST with the exact Origin.

## Focused checks

| Command | Observed result |
| --- | --- |
| node --test tests/request-policy.test.mjs tests/request-races.test.mjs | 11 passed: four policy groups and seven request-ownership cases |
| node tests/local-policy-http.mjs | Three grouped checks passed in copied services with synthetic usage and mocked upstream responses |
| node tests/phase2-http.mjs | Calendar, query validation and security regression checks passed |
| node tests/phase4-http.mjs | 251-Session fixture, full projection guards and four export formats passed |
| node tests/stream-export-http.mjs | Preparation, single slot, pinned refresh, uncapped output, four formats, expiry, abort/interruption and retry passed |
| node tests/month-remote-http.mjs | Seven grouped checks passed, including IPv4/IPv6 wildcard admission, opt-in and private-route/full-path restrictions; no Tunnel mode was run |

Policy cases include hostname case, port 80, wrong ports, trailing-dot/numeric aliases, duplicate Host/Origin/metadata, opaque origins, paths/userinfo/query in Origin, conflicting headers and authority-changing request targets. The final numeric-Origin and URL-normalization checks passed in the focused unit and copied HTTP runs after desktop acceptance; they do not change the accepted normal browser requests.

The local HTTP fixture records handler admission and upstream calls. Invalid source requests to dashboard, settings, diagnostics, account usage and export did not enter handlers, call upstreams or change settings bytes. Invalid update origins/bodies made no GitHub request. Valid POST covered available/current/404/rate-limit/network results. The recorded upstream request was an anonymous GET to the configured fixed GitHub endpoint. Custom and blank repositories retained their behavior. Counts in overlapping reports are not a new aggregate suite total.

## Desktop acceptance

Direct in-app browser checks used only synthetic copied services and a second local origin:

- The manual update button displayed the mocked Version 2.2.0 available result through POST.
- Settings saved Maximum files from 10000 to 9999, displayed success and cleared unsaved state. The isolated .env contained the saved value. The actual request carried matching Origin and same-origin metadata.
- Native Session CSV download saved 1175 bytes. Parsed metadata selected the exact guarded API projection; saved file bytes matched that response. The browser's download GET had same-origin metadata and no Origin, and passed the gate. Only the owned synthetic download was moved into the evidence directory.
- Cross-origin GET fetch, POST fetch and form POST produced three server INVALID_ORIGIN rejections. Handler admission and upstream counts increased by zero; isolated settings bytes were unchanged. This establishes server refusal, rather than relying on browser CORS alone.
- The normal dashboard/settings/download browser console had no errors. The attack fixture had expected refusal errors. All test tabs and child services were closed; disposable roots were removed.

Evidence directory: /Users/ethan/.codex/visualizations/2026/09/30/01a0f0ef-7186-77c2-b30d-f4695955d901/.

Files: local-policy-update-post.png, local-policy-settings-saved.png, local-policy-native-download.png, local-policy-cross-origin.png, local-policy-sessions.csv and local-policy-browser-evidence.json. The JSON records sanitized counts and source headers, not download tickets or production data.

## Boundaries and rollout

No real .env, credential, usage log or pricing cache was modified. Upstream requests in the acceptance fixture were mocked. No Cloudflared tunnel, release write or cloud resource was created. Windows, other browsers, live quota/GitHub endpoint behavior, physical durability, a broad security scan and new performance measurements were not part of this phase. The source contract harness was skipped because it can fetch prices and modify source caches; copied HTTP fixtures provide the selected evidence.

Origin and Fetch Metadata are browser source restrictions, not local process authentication. A local program can forge them; a local proxy can rewrite them. Missing-source GET remains compatible by Q68. Code already running in the dashboard origin is outside this boundary. HTTPS tunnel compatibility and proxy trust are not supported.

The formal 3333 backend still runs its previously started f53726f code. Public assets are served from disk, so a page reload can load the new POST client before that process supports it. A separately authorized restart is required to synchronize the API before normal use of the new client. Existing explicit blank update configuration remains disabled after restart; the default applies only when the key is absent. This phase does not silently replace that local setting.
