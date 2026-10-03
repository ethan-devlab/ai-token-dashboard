# Local settings with wildcard binds

Date: 2026-10-03 (Asia/Taipei). Environment: macOS, Node v26.0.0. All save and remote-bind checks used copied applications, synthetic JSONL, disposable configuration and blocked upstream fetches. The formal 3333 service was not restarted or reconfigured in this phase.

## Trigger and correction

Before the change, a copied application with HOST=0.0.0.0 and ALLOW_REMOTE=1 returned 403 SETTINGS_DISABLED to GET /api/settings through 127.0.0.1. Startup did not acquire settings ownership for a non-loopback bind. The route checked the configured bind address instead of the connection.

Settings now require an admitted Host and source policy, real loopback socket source and destination, and a loopback URL or localhost. Each dashboard process attempts the existing settings lease at startup. A wildcard writer can therefore administer its settings locally. A second process remains read-only, with ownership fixed at startup. POST still requires exact same-origin Origin, a bounded body and the current If-Match revision.

The local check covers IPv4 127/8, IPv6 ::1 and IPv4-mapped loopback. Unknown and scoped non-loopback addresses do not grant access. Forwarded headers do not affect it. The 0.0.0.0 URL does not grant settings access; use localhost or 127.0.0.1. Diagnostics, login-plan usage and full-path bind restrictions did not change. Local programs and proxies that rewrite the connection and headers are not authenticated by these checks. Tunnel support remains outside scope.

## Completed checks

- `node --test tests/request-policy.test.mjs`: five checks passed, including actual endpoint admission, mapped IPv6, LAN/scoped addresses, unknown endpoints, loopback aliases and forged forwarding claims.
- `node tests/month-remote-http.mjs --serve`: isolated HTTP assertions passed. Wildcard loopback GET/save succeeded; stale revisions returned 409; missing or foreign Origin returned 403. localhost worked. A second process returned writable=false and rejected save with SETTINGS_READ_ONLY. IPv6 wildcard admitted IPv6 and IPv4-mapped loopback settings. Existing month, redaction, Host/Origin and restricted API checks passed.
- A real connection through this machine's LAN interface returned redacted usage data, but settings GET and POST returned 403 SETTINGS_DISABLED. Forged proxy headers did not grant access. The fixture .env bytes remained unchanged after these rejected requests. This used the local LAN interface, not a second physical device or external tunnel.
- Desktop in-app browser: the wildcard application opened through 127.0.0.1 with enabled fields. Saving Maximum files from 999 to 1001 displayed Saved to .env and No unsaved changes; the fixture file contained MAX_FILES=1001. The local tab had no console errors. The LAN URL displayed Settings are local only and hid the form. The second process displayed the ownership warning and disabled its form and save button.
- `node tests/settings-owner-http.mjs`: ownership, read-only routes, guarded saves, graceful/failure cleanup and restricted crash recovery passed.
- `node tests/local-policy-http.mjs`: local GET compatibility, cross-origin rejection, same-origin update POST and zero upstream work for rejected requests passed.
- `node tests/process-lifecycle-http.mjs --skip-deadline`: graceful signals, admitted save drain, streamed-download interruption, failed startup/cleanup, native fatal retention and journal failures passed. The unchanged real 30-second deadline check was not repeated.

Desktop evidence outside the repository: `wildcard-local-settings-saved.png` and `wildcard-lan-settings-denied.png` in the existing chat visualization directory. Temporary applications and tabs were closed after validation.

## Deployment status and limits

The running formal service remained bound to 127.0.0.1:3333 and reported writable settings. Its current .env was not changed by this work. A separately selected restart is required to load the corrected backend. No tunnel, external device, full test suite or performance benchmark was run; this phase changes settings admission and ownership initialization only.
