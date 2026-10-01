# Cross-phase functional integration validation

Date: 2026-10-01 (Asia/Taipei). Branch: main. Baseline: a73bbe6. Node: v26.0.0 on macOS.

## Scope and result

The user selected integration acceptance for Phases 1–5 and an inventory of remaining issues. All 115 baseline unit/service/client checks passed. All five phase HTTP fixtures passed against copied application code with external fetch blocked. A new same-server integration fixture passed and exposed one desktop defect, FA24, which is fixed in this checkpoint.

This is bounded fixture acceptance. It does not certify all real log variants, upstream responses, platforms, or production rollout.

## Same-server scenario

tests/functional-integration.mjs copies the current server and assets into a disposable app. It provides 252 logical Codex Sessions, one byte-identical mixed-model copy, and a Claude generic cache-write Session. All credentials and .env writes are synthetic and local to the temporary directory. Upstream requests use mocks. AUTO_REFRESH is enabled with a 100 ms debounce.

The query selects gpt-5.5 observations across the 25-hour New York DST fold day. The two repeated 01:00 buckets contain 10 and 271 Tokens. KPI, model ranking, trend, pages, detail, and exports agree on 281 selected Tokens. The mixed-model Session contributes only 30 selected Tokens and two observations; its excluded same-model turn remains a quality warning. An offset-250 page contains two rows, while Session CSV exports all 252 matched Sessions and JSON metadata declares that full count. JSON reports remain aggregate reports and do not include per-Session rows.

The Claude query retains 105 Tokens, including 70 generic cache-write Tokens with unknown duration and partial pricing. Quota success followed by a transient failure retains stale quota without changing the usage projection. Saving MAX_FILES=1 and AUTO_REFRESH=0 requires a revision and restart; the running scanner stays uncapped and its watcher remains active. These settings do not silently change live data.

A broken JSONL plus a healthy file change cause whole-refresh rollback. Page, detail, and pinned JSON export still use 281 Tokens and identify the retained snapshot. Removing the broken file lets the watcher publish 289 Tokens. Old page, detail, and export identities then return 409. Responses exclude synthetic secrets, account IDs, transcripts, and content hashes.

## FA24 — Refresh warning lost after pagination

Priority: P2. After a failed manual refresh, the browser shows the retained snapshot and reason. Next-page GET succeeds against that same committed snapshot and includes retainedSnapshot=true and refreshFailure=file-parse. Before this fix, mergeSessionPage copied only row/pagination fields. The successful page load cleared the projection error state, while the old dashboard quality lacked the newer failure. The warning disappeared even though refresh had not recovered.

Root desktop evidence: after the failed refresh, page 101–200 still showed snapshot v2 and 289 Tokens, but projectionStatus was empty and quality contained only the mixed-source note. The actual page API still reported one failed file, retainedSnapshot=true, and the failure timestamp.

Fix: equal-identity pages may update only refreshFailure and retainedSnapshot in scan and quality.scan, in addition to existing pagination fields. Totals, costs, trend, models, facets, range quality, scan completeness, and projection identity remain the displayed values. A new unit case checks both the warning and preservation of these values. Different identities still fail closed.

After the fix, the same desktop sequence retains the file-parse warning after pagination. Repair advances the watcher to v3; Next triggers a complete reload to page one with 297 Tokens and removes the old refresh failure. Another quota failure leaves the repaired KPI/model/plot values intact. The earlier mixed-source quality note remains because it is still true.

## Executed validation

- Baseline: node --test tests/phase1-accounting.test.mjs tests/phase2-calendar.test.mjs tests/phase3-reliability.test.mjs tests/phase4-projection.test.mjs tests/phase5-reliability.test.mjs tests/client-state.test.mjs tests/server-services.test.mjs — 115 passed.
- Baseline: node tests/phase1-http.mjs through node tests/phase5-http.mjs — all five passed. Each command creates and removes its own isolated app.
- After FA24: node --test tests/phase4-projection.test.mjs — 10 passed; node --test tests/client-state.test.mjs — 33 passed.
- After FA24: node tests/functional-integration.mjs --serve — passed, including the retained-page merge against an actual HTTP response.
- Changed-module syntax checks and git diff --check passed.

Root desktop QA used English at 1280px and Traditional Chinese at 960px. The mixed-model drawer showed 30 Tokens and two observations. Selecting the GMT-5 chart interval produced exactly 20 Tokens; returning restored the prior filtered query. Clear search retained the selected model and expanded scope to all 252 Sessions. The broken-file rollback kept 289 Tokens while allowing pagination. After FA24, the latest failure warning remained visible. Watcher repair left the browser's displayed snapshot unchanged until Next detected the conflict and reloaded the whole page to 297 Tokens. Quota checks remained independent. The Traditional Chinese repaired model showed US$0.001485; scroll width was 960px. No console errors were captured.

Proof: integration-retained-page-fixed-960.png shows retained 289 input Tokens, snapshot v2, stale quota, and the file-parse warning together. integration-repaired-960.png records the repaired Traditional Chinese surface. The earlier integration-retained-page.png records the pre-fix defect. Temporary tabs, viewport, server, credentials, logs, and settings were removed after QA.

## Remaining inventory

| Item | Current evidence and boundary | Next decision or check |
| --- | --- | --- |
| Cross-process file race | Settings and credential digests catch observed external changes before rename. They cannot exclude a writer in the final check-to-rename interval. | Decide whether a further lifecycle change is needed; do not claim a shared CLI lock. |
| Bounded Session detail | Q27 is complete in the subsequent [detail checkpoint](detail-completeness-validation.md): exact selected count, returned count, limit, and truncation status. Full Token/cost totals remain intact. | Observation pagination and a table are outside the confirmed count/prompt scope. |
| Historical pricing | Q28–Q33 subsequently add complete current-basis archives and read-only tracing. See [pricing-archive-validation.md](pricing-archive-validation.md). | A historical effective-rate ledger and old-basis selection remain separate scope. |
| Browser synchronization | Watcher updates server snapshots. Browser data stays manual; page/detail/export conflicts reload a complete projection. | A future automatic sync policy needs a separate decision. |
| Browser request ownership | The subsequent [request-race checkpoint](request-race-validation.md) resolves FA15's fetch/body exception path and update/diagnostic busy ownership. Fifty focused checks, controlled desktop faults and native fetch cancellation passed. | Other browsers and live-provider timing remain unverified; cancellation does not roll back completed server work. |
| Native file download/unload | The subsequent [native Safari checkpoint](browser-download-settings-validation.md) saved all four formats, compared their actual bytes with the pinned API, checked save cancellation and export conflict, and verified settings leave/reload prompts and successful-save clearing. | Other browsers, Windows, interrupted or very large downloads remain unverified. The earlier in-app completion timeout was not repeated. |
| Windows and other Node versions | Only macOS Node v26.0.0 ran. Recursive watcher, rename/permission behavior, Service/Tray, and Node 18/22/24 remain unverified. | Run the focused commands on each required target. Service/Tray remain unsupported. |
| Live provider/pricing contracts | Fixed endpoint and response/error handling use mocks. No real login, upstream request, credential rotation, or live pricing certification occurred. | A separately authorized live check must preserve credential and network boundaries. |

The source contract harness was not run because it can fetch upstream prices and write source caches. The isolated HTTP fixtures exercise actual routes without those side effects. No production restart/rescan, real .env/credential write, package installation, push, release, or deployment occurred. No mobile/tablet QA was performed.

Windows-local reproduction: run the listed Node commands and node tests/functional-integration.mjs. For desktop acceptance, run node tests/functional-integration.mjs --serve; its break/repair commands create the rollback and watcher-repair sequence. Use page navigation to detect changed versions. quota-fail/quota-ok control only the synthetic quota response. Stop with Ctrl+C. HTTP fixtures require Node 18.19+ for --import; production remains Node >=18.
