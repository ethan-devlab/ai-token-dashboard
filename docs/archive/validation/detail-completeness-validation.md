# Session detail completeness validation

Date: 2026-10-01 (Asia/Taipei). Environment: macOS, Node v26.0.0.

## Confirmed scope

Q27 selects exact adopted observation counts and a truncation prompt. Detail remains bounded at 2000 observations. No observation table or pagination is added. Counts apply after model and time filters. Existing order, projection guards, and redaction remain. Token and cost totals include every adopted observation before the detail array is clipped. Unresolved source observations are not adopted counts; their separate quality warning remains visible.

The API adds observationCount, returnedObservationCount, and observationsTruncated. The drawer shows selected count, returned count, and observationLimit in English and Traditional Chinese. Missing or invalid total metadata stays unknown; an older clipped response cannot prove its complete count.

## Validation

- `node --test tests/detail-completeness.test.mjs tests/phase4-projection.test.mjs`: 14 passed. Covers 0/2000/2001, complete totals and costs, original order, exact model/time filters, both languages, unsupported counts, and existing projection/export behavior.
- `node --test --test-name-pattern='drawer' tests/client-state.test.mjs`: three passed, including home-path redaction, timezone/localization, and unknown versus explicit zero.
- `node tests/detail-completeness-http.mjs --serve`: passed against a copied app and actual parsers. Counts 0/1000/2000/2001; returned array bounded at 2000; detail and dashboard Token/cost totals equal; transcript excluded. External requests are blocked and no real credentials/settings are loaded.
- Root desktop QA: English at 1280px and Traditional Chinese at 960px. The large Session shows 2001 adopted, 2000 returned, limit 2000, complete 2001 Tokens and US$0.010002. UI model selection shows exactly 2000 with no truncation warning. A Claude unresolved conflict shows zero adopted/returned with its conflict warning. No console errors were captured. The 960px page scroll width is 960px and the drawer prompt wraps visibly.
- Syntax and diff checks passed for the changed modules and fixtures.

Proof is saved under `/Users/ethan/.codex/visualizations/2026/09/30/01a0f0ef-7186-77c2-b30d-f4695955d901/`: detail-completeness-en.png and detail-completeness-zh-960.png. The English browser surface reports 1280px but its screenshot is cropped by the in-app frame; the 960px proof shows the complete drawer. Temporary tab, viewport override, server, and copied files were removed after QA.

## Limits

This change does not alter reconciliation, pricing policy, refresh behavior, or detail pagination. The count is the adopted count, not raw JSONL lines or all unresolved source records. Live providers, Windows/Service/Tray, other Node versions, and native download completion were not checked; none is required by this count/prompt change. No production rescan/restart, real settings/credential write, dependency installation, push, release, or deployment occurred. No mobile/tablet QA was performed.

Windows-local reproduction: run the same Node commands above. The HTTP fixture requires Node 18.19+ for --import. Start desktop QA with --serve and stop with Ctrl+C.
