# Request ownership and cancellation validation

Date: 2026-10-01 (Asia/Taipei). Platform: macOS, Node v26.0.0, in-app desktop browser at 1280 x 720. Scope: FA15, Provider changes, late failures, cancellation and busy controls.

## Findings and change

The original FA15 HTTP-status path was already corrected in Phase 4: a superseded HTTP error response returned stale before its error was raised. This checkpoint reproduced a different path. Rejection from fetch, JSON parsing or Blob reading bypassed that stale check. A controlled old diagnostic JSON failure displayed a notice after switching from Codex to Claude. The cancelled diagnostic also kept its button busy until the ignored-cancellation promise settled.

These failures were reproduced with synthetic promises that deliberately ignore AbortSignal. They are evidence of a robustness gap, not a claim that normal browser fetch routinely ignores cancellation. A separate native-fetch case preserves the real signal and checks actual browser cancellation.

Changes are limited to two product files:

- `public/scripts/request-channels.mjs`: check ownership before body consumption and after it; apply the same ownership rule to fetch/body exceptions. Superseded results and failures return stale. Active failures and HTTP error metadata still propagate. Older finally handlers cannot delete the current channel.
- `public/scripts/dashboard.mjs`: update and diagnostic actions carry attempt generations. Provider changes invalidate those actions and release their buttons immediately. Only the current attempt can publish results/errors or end its busy state. The existing projection/export and account-usage policies remain intact.

No new API, dependency, synchronization policy, quota policy or pricing rule was added. Cancellation remains best effort for server work. This change controls which browser request can publish UI state; it does not roll back a server operation that has already started.

## Focused checks

Run:

```sh
node --test tests/request-races.test.mjs tests/phase4-projection.test.mjs tests/client-state.test.mjs
```

All 50 checks passed: seven new request-race cases, ten projection/export cases and 33 client cases. The new cases cover late fetch rejection, late JSON and Blob rejection, Codex/Claude/Codex ownership, no body read after supersession, active errors, independent channels and preserved current HTTP-conflict fields. They use controlled promises to test outcomes without relying on timing.

Syntax checks and git diff --check also passed. No broad suite or source contract harness was run: the change is limited to browser request ownership, and the source contract harness can fetch upstream prices and write source caches.

## Isolated browser evidence

Run `node tests/request-race-browser.mjs --serve`. It copies the shipped server/assets, creates separate 10-Token Codex and 20-Token Claude JSONL fixtures, checks those totals over HTTP, disables external fetch and uses absent test credentials. The browser-only quota response is explicitly synthetic: Codex 75%, Claude 40%, plan TEST_ONLY. Its fault controls exist only in the temporary app. They are not shipped in public/.

Hold next fetch/body deliberately ignores cancellation and allows explicit release or rejection from the test panel. Delay native fetch uses a 10-second delay in the copied HTTP server and keeps the real AbortSignal. The fixture server change is only an added test delay; production server.mjs is unchanged. The initial test asset used an unsupported .js static path and returned 404. The fixture was corrected to use the existing .mjs route without changing the product's static-file allowlist.

The baseline was captured before product edits. After editing, reload-assets copied the two changed product assets into the same fixture and the browser reloaded. A fresh fixture then exercised the native cancellation mode.

| Scenario | Observed result after correction |
| --- | --- |
| Hold old Codex diagnostic body; switch to Claude | Old signal aborted and Load became available immediately |
| Start held Claude diagnostic; reject old Codex parse | Claude stayed busy; no old notice appeared |
| Release Claude diagnostic | Correct provider=claude JSON appeared; busy=false |
| Hold old update fetch; switch Provider; start new held update | Old success did not clear the new busy state or publish a notice |
| Reject current update fetch | Current failure remained visible and its button recovered; ordinary successful retry still worked |
| Hold Codex quota; switch to Claude, then Codex; reject first Codex parse | Claude showed 40%, new Codex showed 75%; old failure did not clear the new quota |
| Hold Claude dashboard body; return to Codex; release old success | Codex KPI, plot and Session remained at 10 Tokens |
| Hold Codex detail; close and switch Provider; cancel old detail and reopen Claude | Closed old detail did not reopen or publish an error; reopened Claude showed its full 20 Tokens. A stale failure against an actively open same-key drawer was not claimed |
| Hold Claude export fetch; switch to Codex; reject old fetch | Download recovered, old error was ignored and Codex remained at 10 Tokens. Native file completion is covered by the preceding download checkpoint |
| Hold Codex pricing fetch; switch to Claude; reject old fetch | Pricing button recovered, no old notice appeared, Claude remained at 20 Tokens |
| Delay native diagnostic HTTP response; switch to Claude | Actual browser fetch reported aborted; a new Claude diagnostic succeeded with busy=false and no notice |

No browser console errors were captured. Test controls do not validate product accessibility. The drawer's backdrop blocked one test-panel click; the drawer was closed before releasing that fault, rather than bypassing its modal boundary.

Evidence files are under `/Users/ethan/.codex/visualizations/2026/09/30/01a0f0ef-7186-77c2-b30d-f4695955d901/`: request-race-before.png, request-race-fixed.png and request-race-native-abort.png. The first two show the controlled before/after path. The last records the new diagnostic after native cancellation.

## Boundaries

Production localhost:3333, real configuration, credentials and price caches were not changed. No live upstream request, package installation, production restart, push or release occurred. The test tab and temporary servers were closed after validation. No mobile/tablet QA ran.

Windows, other browsers, Node 18/22/24 and live-provider timing remain unverified. The focused Node command above is also the Windows-local reproduction command; the browser fixture uses Node 18.19+ for --import. Cross-process credential/settings writes and future automatic browser sync remain separate scope.
