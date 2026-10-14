# Month input, price discovery and remote bind validation

Date: 2026-10-02 (Asia/Taipei). Environment: macOS arm64, Node v26.0.0, Safari and the in-app browser. All mutable runtime checks used copied applications, synthetic logs and isolated configuration. The running service on port 3333, its configuration, credentials and pricing files were not changed or restarted.

## Decisions and delivered behavior

- September input `2026-9` failed both the HTTP period validator and the calendar resolver. Both now accept one- or two-digit months. Browser controls, restored URLs and request parameters use `2026-09`. Impossible months, dates and ambiguous DST inputs still fail.
- Q61: prices have case-insensitive name search and natural numeric version sorting within each naming family. Rates and their archived basis do not change when the list is filtered. Names do not establish release dates.
- Q62: wildcard binds admit the actual local destination IP and configured port. Configured authorities and loopback behavior remain compatible. External Host names, wrong ports and forwarded-header spoofing remain rejected. Private APIs and loopback-only full paths retain their restrictions.
- Q63: HTTPS tunnel Host/Origin compatibility is deferred. No external-domain allowlist, HTTPS Origin exception or proxy trust was added.

The user's price screenshot already contained the newer models at the bottom. A read-only GET of the official OpenAI pricing Markdown returned HTTP 200; the existing parser found 40 rows, including `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-luna` and `gpt-6-sol`. This confirmed a discovery/order problem at the time of the check. It did not update or certify the running service's cache. Source: [OpenAI pricing](https://developers.openai.com/api/docs/pricing).

## Focused automated checks

```sh
node --test tests/phase2-calendar.test.mjs tests/month-pricing-controls.test.mjs
node --test --test-name-pattern='runtime configuration|settings persistence' tests/server-services.test.mjs
node tests/month-remote-http.mjs
node tests/phase2-http.mjs
node tests/phase4-http.mjs
node tests/stream-export-http.mjs
```

The first command passed 16 cases. The service command passed its two selected cases. Existing calendar HTTP, projection/export and streaming HTTP checks passed after the shared request-gate change. These runs overlap with previous reports and are not a new aggregate suite count.

The new copied-service HTTP fixture passed six groups:

1. Non-loopback bind requires opt-in; full-path exposure with a non-loopback bind fails before serving.
2. September returns exactly seven synthetic Tokens and Taipei September bounds; October's thirteen Tokens are excluded. Invalid months remain rejected.
3. Actual loopback responses hide or expose the synthetic full workspace path according to configuration.
4. IPv4 wildcard requests to the real destination work; wrong ports, external Host, spoofed forwarded headers and HTTPS Origin fail. A same-machine request through the LAN interface also passed.
5. Remote settings, diagnostics and login-plan usage return 403.
6. IPv6 wildcard requests through `::1` work with the remote privacy restrictions.

Unit checks also reject a Host that names a different local interface from the socket destination. The LAN check is same-machine evidence, not acceptance from a second device. Forged Host checks use `http.request`; this Node fetch implementation did not apply the custom Host header.

## Desktop and restart checks

Safari used a new tab on the synthetic fixture. Entering `2026-9` produced `2026-09`, canonical URL state, September bounds and seven Tokens. Price search showed `gpt-6.1-sol` before `gpt-6-sol`; English, Traditional Chinese and no-match states were checked.

The in-app browser saved both network checkboxes on a loopback fixture. Before restart, paths stayed redacted. Restarting only the owned copied service preserved the exact saved configuration bytes and exposed the synthetic workspace path. With full paths enabled, changing Host to `0.0.0.0` and opting into remote bind failed with the loopback requirement; unsaved edits remained visible. Browser error logs were empty. Test tabs and processes were closed and disposable application roots were removed.

Saved desktop artifacts under `/Users/ethan/.codex/visualizations/2026/09/30/01a0f0ef-7186-77c2-b30d-f4695955d901/`:

- `safari-september-input-fixed.png`
- `safari-model-price-search.png`
- `safari-model-price-search-zh.png`
- `settings-flags-isolated-saved.png`
- `settings-remote-path-conflict.png`

## Cloudflared result and limits

Two actual Quick Tunnels registered a connection: one with the default upstream Host behavior and one with an explicit upstream Host override. Both exposed only the synthetic remote fixture. Requests to both generated public domains failed DNS resolution with `ENOTFOUND` in this environment. No external HTTP response was obtained. External Host rejection, redaction, private API denial and HTTPS Origin rejection therefore have local HTTP evidence only; tunnel end-to-end acceptance remains unverified. Both tunnels were stopped.

The optional `node tests/month-remote-http.mjs --tunnel` command performs a live check and must not run as an automatic unit/CI check. Its network-failure record is a validation gap, not a passing tunnel assertion. `--serve` is for manual isolated desktop checks. No real session or credential data is used. The CLI setup follows [Cloudflare Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

No production restart, second-device LAN check, Windows check, full source contract suite or performance benchmark was performed. The source contract suite can fetch and write live source caches; the copied fixtures provide the bounded route evidence. These small changes do not certify general remote deployment or HTTPS tunnel support.

## Authorized local startup follow-up

After commit f53726f, the user selected local restart and validation. Port 3333 had no listener. Both owner locks identified the same absent PID on this machine. The restricted `node server.mjs --unlock-settings` and `node server.mjs --unlock-pricing` commands succeeded; no force recovery or manual lock deletion was used. `npm start` then loaded the current source on `127.0.0.1:3333` with Node v26.0.0. The service was left running for the user.

The exact .env SHA-256 matched before and after startup and validation. Runtime Host/port and full-path policy remained `127.0.0.1`, `3333` and false. Settings and pricing write ownership were available. Codex was available and watching; Claude remained unavailable because its configured Session directory was missing. This check did not repair or alter that source configuration.

Actual dashboard queries with `period=2026-9` and `period=2026-09` returned 200, equal Token totals and the correct Taipei September bounds. `2026-13` returned 400. HTTP-served state, pricing-table and dashboard modules matched the checked-in source bytes. A new in-app browser tab showed the September period with a canonical month control. Searching `gpt-6` returned four of the 48 retained model rates, beginning with `gpt-6.1-sol`, then `gpt-6-sol`. Browser error logs were empty; the test tab was closed. Screenshots: `live-september-after-restart.png` and `live-model-search-after-restart.png` in the artifact directory above.

This establishes one local source startup and its bounded live behavior. The preceding no-production-restart statement describes the isolated checks before this authorization. It does not certify a packaged release, remote deployment, tunnel support, all real-log variants or all model-cost history.
