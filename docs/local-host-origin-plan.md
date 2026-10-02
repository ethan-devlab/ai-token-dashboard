# Local Host and Origin protection plan

Date: 2026-10-02 (Asia/Taipei). Source checkpoint: bd040cb. Status: policy and implementation plan only; the request protections below are not implemented. The default update repository is already delivered in bd040cb.

## Confirmed scope

- Q64/Q67 replace the earlier fixed-domain selection: keep localhost/127.0.0.1 and existing IPv6 loopback support. No Tunnel, public hostname, DNS, certificate, proxy-trust configuration or cloud resource is included.
- Q68: keep valid local GET requests without Origin or Fetch Metadata for direct API tools. Reject explicit cross-origin browser requests. POST still requires a precise same-origin Origin. This does not authenticate another local process.
- Q69: local update checks use POST /api/update. GET returns 405 and causes no upstream request. The UI remains a manual button. Each installation reads public GitHub Releases anonymously through the existing server-side GET.
- The user requested the default update source `ethan-devlab/codex-token-dashboard`. It is delivered separately; explicit blank disables checks, a custom repository takes precedence, and process environment overrides remain ignored. See [source validation](update-source-validation.md).

Existing opt-in remote-bind behavior and its private API/full-path restrictions are retained. This phase designs local protections and makes the shared update-method change. It does not remove the previously delivered LAN feature, add remote authentication or certify proxy access. No new local login, CSRF secret, dependency or background update schedule is introduced.

## Evidence and protection boundary

server/config.mjs has exact configured/loopback Host checks and Q62 socket-destination checks for wildcard binds. server.mjs validates Host globally and requires Origin on POST, but does not apply a common source check to GET APIs. GET /api/update calls the release checker. public/scripts/dashboard.mjs currently calls that endpoint as GET; request-channels.mjs already supports a method option and protects request generations.

Origin identifies scheme, host and port; it can be absent on same-origin GET and can be null in opaque contexts. Fetch Metadata distinguishes same-origin, same-site, cross-site and user-initiated navigation. See [MDN Origin](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin) and [MDN Sec-Fetch-Site](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Sec-Fetch-Site).

Host admission limits accepted destination authorities, including DNS-rebinding attempts with an external Host. Origin and Fetch Metadata restrict browser requests. These headers are not identity credentials: local programs can supply them. Loopback binds also cannot establish that a visitor is local when a separate local proxy forwards traffic. No proxy defense or hostile same-user-process isolation is claimed.

## Request policy

Apply checks before Provider scans, credential reads, pricing verification, export admission, settings writes or upstream requests. Keep existing JSON error envelopes where the request reaches the application. Node may reject malformed HTTP before an application error can be generated.

1. Require exactly one valid Host authority. Reject missing/duplicate Host, userinfo, separators, malformed ports and unexpected domains. Preserve the existing permitted configured authority, exact loopback names and Q62 socket destination. Compare the effective port to CONFIG.port; only HTTP port 80 may omit the port. Accept hostname case differences, not trailing-dot or arbitrary numeric-address aliases. Do not perform request-driven DNS resolution.
2. Build the expected HTTP origin from that admitted authority, with normal default-port serialization. Accept only an origin-form request target: reject absolute URLs and network-path targets rather than allowing new URL to replace the admitted authority. Preserve existing static traversal protection.
3. For /api and /api/* GET, accept absent Origin. If present, require one HTTP origin matching the admitted request authority; reject null, multiple values, other aliases, other ports, HTTPS, credentials, paths, queries and fragments. localhost and 127.0.0.1 remain separate origins even though both Hosts can be admitted.
4. For those API GET requests, accept absent Sec-Fetch-Site, same-origin or none. Reject same-site, cross-site, unknown or duplicate values. Explicit source evidence cannot be overridden by another accepted header. Do not add CORS allow headers or preflight permission.
5. For every implemented POST route, require the same precise Origin. Missing Fetch Metadata remains compatible with existing direct POST tools that supply Origin; if Sec-Fetch-Site is present, require same-origin. Null/missing Origin, none/same-site/cross-site or malformed metadata is rejected. Preserve existing settings revision, ownership, body-limit and download-projection checks.
6. Forwarded, X-Forwarded-Host and X-Forwarded-Proto never change the admitted Host, expected origin or API access mode. No trusted-proxy exception is added. Their mere presence is not proof of a proxy; ignoring them also does not detect a proxy that rewrites other headers.

Static HTML/assets keep the global Host gate, CSP and nosniff rules. They do not receive the API source restriction: a normal bookmark or link can open the local UI, which then uses its own same-origin API. API response and download access use the source gate. CSP frame-ancestors remains none. This change does not create a browser identity or protect against code already executing in the Dashboard origin.

| Request | Planned result |
| --- | --- |
| Valid Host, GET dashboard without source headers | Allowed under Q68 |
| Valid Host, API GET with matching Origin/same-origin metadata | Allowed |
| Valid Host, API GET from a different Origin, same-site or cross-site metadata | 403 before data or side effects |
| Valid Host, direct address-bar API/download navigation with metadata none and no Origin | Allowed; existing download ticket/slot rules still apply |
| Valid Host, POST with exact Origin and missing or same-origin metadata | Allowed subject to existing route requirements |
| Invalid Host, duplicate source headers, null Origin or conflicting source evidence | Rejected before the handler |
| GET /api/update with an otherwise valid local request | 405 METHOD_NOT_ALLOWED, Allow: POST, no GitHub request |
| POST /api/update with valid source and no body | Existing update result; manual anonymous GitHub GET |

Origin failures retain 403 INVALID_ORIGIN. Fetch Metadata failures use 403 INVALID_FETCH_METADATA. Host failures retain 400 INVALID_HOST. Invalid request targets use 400 INVALID_REQUEST_TARGET. Unsupported methods retain 405 METHOD_NOT_ALLOWED. Rejecting a request must not consume an export ticket or occupy an export slot.

## Implementation boundaries

- Add a small request-policy module in server/ for authority, Origin, metadata and raw-header checks. Reuse allowedRequestHost; avoid a second independent Host whitelist. Keep URL parsing and API/POST policy at the request gate in server.mjs.
- Change only the update route method and its client request option. Preserve updateGeneration, request-channel cancellation, notices and busy ownership. GET /api/update has no compatibility action or network-triggering redirect.
- The new update POST accepts no body. Reject nonzero Content-Length or Transfer-Encoding before invoking the checker; do not treat an undeclared chunked body as empty. Other routes retain their existing bounded body behavior.
- Document the update-method migration in README.md, docs/api-v2.md and docs/security.md. Describe the local-program/proxy limits accurately. Update repository tests that intentionally exercise /api/update.
- Keep query/calendar, accounting, pricing, settings ownership, watcher and download semantics unchanged. Do not edit the running .env, restart 3333, expose private data or create tunnels during implementation validation.

## Focused acceptance plan

Implement first, then add focused validation; no TDD or broad security scan is required.

1. Unit cases: existing loopback/wildcard authorities; hostname case; port 80 with/without explicit port; invalid/wrong ports; external/trailing-dot/numeric aliases; single and duplicate Host/Origin/metadata; origin path/userinfo/query rejection; request targets that attempt to override the authority; conflicting headers. Test normalized origins without loosening the whitelist.
2. Copied HTTP service: valid missing-source GET, explicit cross-origin GET to dashboard/settings/diagnostics/login usage/export, null Origin and all Fetch Metadata values. Count fixture handler calls to prove rejected requests cause no scan, credential fetch, upstream request, export admission or settings replacement. Use raw HTTP for duplicate/forged headers; do not infer Host overrides from Node fetch.
3. Update migration: mocked GitHub responses with the default/custom/blank repositories; GET returns 405 with zero upstream calls; valid POST makes one anonymous fixed-endpoint GET. Invalid source or body makes zero calls. Check current/available/404/rate-limit/network behavior and existing request-generation races without using a real release write.
4. Desktop browser: use isolated services with mock upstream responses. Verify normal dashboard, settings save, manual update button and prepared native download. A second origin serves a synthetic page that attempts API fetch and form POST; record server rejection. Check native download navigation headers in the actual browser before finalizing its source policy. Do not claim CORS alone proves server rejection. Save desktop screenshots; no mobile/tablet work.
5. Narrow regressions: relevant request-policy/service cases, copied calendar/projection/streaming HTTP checks and the existing remote-bind fixture. Keep Q62 wildcard behavior and private API denial. Run broader checks only if a change or failure justifies them.
6. Record evidence and limitations; inspect and commit completed files. Offer an explicit local restart decision after the isolated implementation is complete. A live service restart is separate from the current design authorization.

The user must confirm this concrete plan before implementation. The accepted GET-to-POST migration is the only intended public endpoint break; direct callers must send POST with the appropriate Origin. No private sample logs or credentials are needed for the acceptance fixtures.
