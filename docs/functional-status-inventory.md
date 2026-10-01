# Current functional status and remaining scope

Date: 2026-10-01 (Asia/Taipei). Reviewed source checkpoint: c520717 on main. This inventory reconciles the original audit with later implementation and validation records. It makes no product change and does not repeat the prior test runs.

## Status rules

Resolved means the documented trigger has implementation and focused validation evidence. It does not mean every log variant, operating system or failure mode is certified. Implemented policy means the user's selected behavior is delivered; a rejected alternative is not an open defect. A risk is a known boundary. A validation gap is behavior that was inspected or not exercised, rather than a confirmed failure.

All 17 defects reproduced by the original bounded audit have correction evidence. The later FA24 integration defect is corrected. FA15's original HTTP path and subsequent fetch/body exception path are corrected. Five policy items have confirmed decisions and implementation. These statements do not imply that the application has zero defects.

## Original issue register

| ID | Current status | Delivered behavior | Evidence |
| --- | --- | --- | --- |
| FA01 | Resolved | Selected ISO week determines its historical calendar bounds | [Phase 2](phase2-calendar-validation.md) |
| FA02 | Resolved | Impossible dates and invalid calendar periods fail instead of normalizing | [Phase 2](phase2-calendar-validation.md) |
| FA03 | Resolved | Repeated DST hours have separate UTC bucket identities and offset labels | [Phase 2](phase2-calendar-validation.md) |
| FA04 | Resolved | Claude generic cache-write Tokens remain in totals; missing TTL price stays unknown | [Phase 1](phase1-accounting-validation.md) |
| FA05 | Resolved | Event model drives ranking, facets and selected observation totals across surfaces | [Phase 1](phase1-accounting-validation.md) |
| FA06 | Resolved | Aggregate/model/trend share partial-cost qualification | [Phase 1](phase1-accounting-validation.md) |
| FA07 | Resolved | CSV exports all matching Sessions, independent of page offset | [Phase 4](phase4-projection-validation.md) |
| FA08 | Resolved | A 150000-observation projection avoids argument-spread failure | [Phase 3](phase3-reliability-validation.md); not a performance benchmark |
| FA09 | Resolved | Any hard file failure rolls back the full refresh and retains the prior complete snapshot | [Phase 3](phase3-reliability-validation.md) |
| FA10 | Implemented policy | Per-model cumulative priority; unmatched turns are uncertain, not claimed as numerically covered | [Phase 1](phase1-accounting-validation.md), Q7 |
| FA11 | Resolved | Exact file cap is complete; an extra eligible file establishes truncation | [Phase 3](phase3-reliability-validation.md) |
| FA12 | Resolved | Null/unsupported quota values stay unknown; measured zero remains valid | [Phase 5](phase5-reliability-validation.md) |
| FA13 | Implemented policy | Verified same-login success is stale after transient upstream failure; auth/login changes clear it; expired windows become unknown | [Phase 5](phase5-reliability-validation.md), Q22/Q24 |
| FA14 | Resolved | Missing roots recover and replaced roots rebind with bounded watcher ownership | [Phase 3](phase3-reliability-validation.md) |
| FA15 | Resolved within tested scope | Stale HTTP, fetch, JSON and Blob failures cannot publish current UI; action generations protect busy state | [Request races](request-race-validation.md); controlled ignored-cancellation faults plus native abort |
| FA16 | Resolved | Page/detail/export guard the displayed projection; conflict reloads the whole page and stops download | [Phase 4](phase4-projection-validation.md), [native downloads](browser-download-settings-validation.md) |
| FA17 | Resolved | All formats identify bounds, query scope and versions | [Phase 4](phase4-projection-validation.md) |
| FA18 | Implemented policy | Dedup requires identical content or explicit event identity within Provider/Session/execution scope; Session ID alone is insufficient | [Phase 1](phase1-accounting-validation.md), Q8/Q10/Q11 |
| FA19 | Resolved | Cap and incomplete scan qualifiers reach dashboard, quality and exports | [Phase 3](phase3-reliability-validation.md) |
| FA20 | Resolved within one process | Exclusive temporary writes and serialized saves; required settings revision rejects stale forms | [Phase 5](phase5-reliability-validation.md); external-writer boundary remains below |
| FA21 | Resolved | Zero page limit and invalid instant bounds fail; offset zero remains valid | [Phase 2](phase2-calendar-validation.md) |
| FA22 | Accepted and implemented | Budget classification uses known cost, with a partial-pricing explanation; unavailable cost is unknown | [Phase 1](phase1-accounting-validation.md), [pricing archives](pricing-archive-validation.md), Q6 |
| FA23 | Implemented policy | Uncertain partial counter-reset increment is skipped; baseline advances and incomplete usage is visible | [Phase 1](phase1-accounting-validation.md), Q9 |
| FA24 | Resolved | Equal-identity pagination retains the latest failed-refresh warning without mixing projection data | [Cross-phase acceptance](functional-integration-validation.md) |

## Completed follow-up checkpoints

| Scope | Current result | Evidence |
| --- | --- | --- |
| Empty CSV, Q21 | Typed metadata record retains scope/filters/versions with blank measurements; data rows remain distinguishable | [Phase 4 follow-up](phase4-projection-validation.md) |
| Detail completeness, Q27 | Exact adopted selected count, returned count, 2000 limit and truncation status; Token/cost totals use full data | [Detail validation](detail-completeness-validation.md) |
| Pricing archives, Q28–Q33 | Current-basis recalculation, complete immutable basis archives, read-only tracing, activation after successful archive and unknown-cost failure behavior | [Pricing validation](pricing-archive-validation.md) |
| Native download/settings leave | Safari saved all four formats with exact pinned API byte matches; cancellation, conflict, app/native leave prompts and successful-save clearing passed | [Browser validation](browser-download-settings-validation.md) |
| Request ownership | Fifty focused checks, Provider races and native cancellation passed; only current attempts can publish or release busy state | [Request-race validation](request-race-validation.md) |

Counts in these reports overlap. Do not add them to claim a new aggregate suite run. This inventory only checks the current implementation, test cases and saved validation records.

## Known remaining boundaries

| ID | Boundary and evidence | Next action that would reduce uncertainty |
| --- | --- | --- |
| R01 | Settings and Claude credentials can be replaced by an uncooperative external writer after the last digest check but before rename. In-process queues and digest checks do not provide a shared CLI lock. A subsequent [controlled child-writer probe](cross-process-write-review.md) reproduces both overwrites and verifies protection before the final check. | Decide settings ownership and Claude automatic-rotation policy independently before implementation. A dashboard-only lock cannot guarantee CLI exclusion |
| R02 | Pricing basis publication is exclusive, but metadata/cache pointers have no shared process lifecycle lock. A cache write failure can restore an older cache at restart. Active archive deletion after activation is not continuously monitored; read-only lookup detects missing/corrupt records. The archive is not a tamper-proof or power-loss-certified ledger. | Decide whether multi-instance ownership, active-archive revalidation or durability needs a separate phase; keep Q28–Q33 semantics explicit |
| R03 | Projection/export generation is buffered. Export checks its 32 MiB limit after constructing the body. The 150000-event correctness result does not establish latency, peak memory or concurrent-load limits. Archive listing also enumerates all retained filenames. | Measure isolated workload sizes and memory first; choose targets before streaming/caching/worker redesign |
| R04 | Scan membership/fingerprints and dirty generations establish a stable admitted pass, not an atomic filesystem-wide snapshot or guaranteed delivery of every OS watcher event. | Exercise remaining scan/watch failure paths before changing this policy |
| R05 | Checked-in commits and isolated acceptance do not establish the code loaded by a running production process or a released artifact. No production rollout was certified. | Choose a separate controlled rollout/restart and packaged-artifact validation scope |

## Validation gaps

| ID | Not yet established | Concrete follow-up |
| --- | --- | --- |
| V01 | Windows filesystem/hard-link/rename permissions, recursive watcher and the supported Node-version matrix | Run the focused commands in each checkpoint on the required targets; do not infer Windows behavior from macOS |
| V02 | Live pricing document format, quota endpoints, real OAuth/CLI interaction and release-check endpoint behavior | A separately selected live check must preserve fixed endpoints, credential privacy and current manual-action boundaries |
| V03 | Populated real Provider-log variants beyond the synthetic identity/cumulative/turn cases | Validate sanitized representative logs without exporting transcripts or credentials |
| V04 | Settings/OAuth disk-full and denied-write behavior; power-loss recovery | Use disposable paths and injectable failures. Pricing archive failure was already tested; that does not certify other writes |
| V05 | Actual watcher error emission, worker exit without a message, symlink-swap/deletion timing, partial append and empty-directory edge cases | Build focused isolated cases. Active worker termination, same-size restored-mtime replacement, in-flight writes, dirty follow-up and root recovery already have evidence |
| V06 | Oversized 32 MiB export rejection under load, interrupted/very large native downloads and browsers other than native Safari/in-app browser | Test actual limit behavior and saved files; the prior in-app completion timeout should not be repeated unchanged |
| V07 | Forced colors and assistive technology | Perform desktop-only interaction checks; prior geometry and AX evidence alone do not certify these modes |

No gap above is reported as a newly reproduced defect. Native Service/Tray remain unsupported/deferred, rather than a tested shipping feature. The source contract harness remains skipped because it can fetch upstream prices and write source caches; isolated route fixtures provide the bounded HTTP evidence.

## Product decisions that remain separate

Manual browser updates are already selected by Q20; automatic watcher-to-browser synchronization needs a new decision. Historical effective-rate pricing, archived-version activation and archive cleanup are separate from the delivered current-basis/read-only/permanent-retention policy. Observation pagination/table is outside Q27's count-and-prompt scope. Deprecated /api/summary retains all-snapshot totals with filtered Session rows for compatibility; changing or retiring that contract needs a separate decision. Resource targets and stronger multi-process/credential lifecycle protection are also undecided.

Recommended next frontier: R01 because an external writer can affect configuration or login continuity. Decide settings and credential ownership separately and test a concrete interleaving before choosing a mitigation. A bounded alternative is V04's storage-failure injection. R03's measurement phase can follow without promising performance before collecting data. Platform/live rollout work remains a validation track, not a reason to silently change accounting or compatibility policies.

## Inventory verification

This pass read the current summary-cache generation loop, watcher invalidation/retry, file fingerprint and parser guards, settings and credential check/rename sequences, export limit and legacy-summary route. It cross-checked the relevant focused test cases and each phase's saved report. Documentation links and unique FA01–FA24 coverage were checked; git diff --check passed. No tests, browser QA, production requests or state mutations were repeated for this documentation-only inventory.
