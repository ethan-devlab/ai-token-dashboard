# Current functional status and remaining scope

Date: 2026-10-01 (Asia/Taipei). Reviewed source checkpoint: 59e30b6 on main. This inventory reconciles the original audit with implementation through Q60 and the saved validation records. This pass changes documentation only and does not repeat prior runtime checks.

Follow-up: 2026-10-02. The month-input and Q61–Q63 implementation added focused runtime checks, recorded in the linked follow-up report. The original inventory verification below describes the 2026-10-01 documentation pass only.

Q34–Q39 settings/credential ownership, Q40–Q50 query/native downloads and Q51–Q60 pricing ownership/recovery are delivered. The old buffered-download limit and unresolved pricing-writer policy are historical. External-editor, storage, live-contract and platform boundaries remain below.

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
| FA15 | Resolved within tested scope | Only current request generations publish or end busy state; native download admission and pricing actions retain Provider ownership | [Request races](request-race-validation.md), [stream delivery](query-export-performance-validation.md), [pricing actions](pricing-ownership-recovery-validation.md); Blob checks describe the retired download workflow |
| FA16 | Resolved | Page/detail/export guard the displayed projection; conflict reloads the whole page and stops download | [Phase 4](phase4-projection-validation.md), [native downloads](browser-download-settings-validation.md) |
| FA17 | Resolved | All formats identify bounds, query scope and versions | [Phase 4](phase4-projection-validation.md) |
| FA18 | Implemented policy | Dedup requires identical content or explicit event identity within Provider/Session/execution scope; Session ID alone is insufficient | [Phase 1](phase1-accounting-validation.md), Q8/Q10/Q11 |
| FA19 | Resolved | Cap and incomplete scan qualifiers reach dashboard, quality and exports | [Phase 3](phase3-reliability-validation.md) |
| FA20 | Resolved for cooperative dashboard writers | Exclusive temporary writes, queued ownership checks, one startup writer and required revisions reject stale/non-owner saves | [Phase 5](phase5-reliability-validation.md), [ownership validation](settings-ownership-validation.md); independent editors remain below |
| FA21 | Resolved | Zero page limit and invalid instant bounds fail; offset zero remains valid | [Phase 2](phase2-calendar-validation.md) |
| FA22 | Accepted and implemented | Budget classification uses known cost, with a partial-pricing explanation; unavailable cost is unknown | [Phase 1](phase1-accounting-validation.md), [pricing archives](pricing-archive-validation.md), Q6 |
| FA23 | Implemented policy | Uncertain partial counter-reset increment is skipped; baseline advances and incomplete usage is visible | [Phase 1](phase1-accounting-validation.md), Q9 |
| FA24 | Resolved | Equal-identity pagination retains the latest failed-refresh warning without mixing projection data | [Cross-phase acceptance](functional-integration-validation.md) |

## Completed follow-up checkpoints

| Scope | Current result | Evidence |
| --- | --- | --- |
| Empty CSV, Q21 | Typed metadata record retains scope/filters/versions with blank measurements; data rows remain distinguishable | [Phase 4 follow-up](phase4-projection-validation.md) |
| Detail completeness, Q27 | Exact adopted selected count, returned count, 2000 limit and truncation status; Token/cost totals use full data | [Detail validation](detail-completeness-validation.md) |
| Pricing ownership, Q51–Q60 | One pricing writer, explicit reader load, publish-before-activation, response verification, metadata separation and conservative repair/restart recovery | [Pricing ownership validation](pricing-ownership-recovery-validation.md) |
| Pricing archives, Q28–Q33 | Current-basis recalculation, complete immutable basis archives, read-only tracing, activation after successful archive and unknown-cost failure behavior | [Pricing validation](pricing-archive-validation.md) |
| Native download/settings leave | Safari saved all four formats with exact pinned API byte matches; cancellation, conflict, app/native leave prompts and successful-save clearing passed | [Browser validation](browser-download-settings-validation.md) |
| Request ownership | Fifty focused checks, Provider races and native cancellation passed; only current attempts can publish or release busy state | [Request-race validation](request-race-validation.md) |
| Query/native streaming, Q40–Q50 | Selective projections, bounded reuse, uncapped native downloads, one slot, deadlines and pinned content satisfy the selected local workload targets | [Stream delivery](query-export-performance-validation.md), commit 348a8ba |
| Post-pricing resource acceptance | At 150000 observations, first dashboard 1147.7 ms, warm/filter 163.1–167.6 ms, page/detail at most 43.5 ms, each export preparation plus transfer at most 123.1 ms; normal observed RSS 388.4 MiB | [Pricing ownership acceptance](pricing-ownership-recovery-validation.md), commit 59e30b6 |
| Month input and Q61–Q63 follow-up, 2026-10-02 | One-digit month input works; model prices have name/version order and search; wildcard bind accepts the actual destination IP while retaining Host/Origin and private API restrictions | [Focused HTTP, desktop and restart validation](month-pricing-remote-validation.md); Quick Tunnels registered, but public DNS returned ENOTFOUND, so external acceptance remains unverified |

The [initial performance baseline](performance-baseline.md) preserves the former 32 MiB rejection measurement. It does not describe the current download contract. The post-pricing run is the latest measurement, not a general hardware or concurrency guarantee.

Counts in these reports overlap. Do not add them to claim a new aggregate suite run. This inventory only checks the current implementation, test cases and saved validation records.

## Known remaining boundaries

| ID | Boundary and evidence | Next action that would reduce uncertainty |
| --- | --- | --- |
| R01 | Q34 removes dashboard credential writes and OAuth refresh. Q35–Q39 coordinate one settings writer, read-only instances and explicit stale recovery. An independent .env editor can still write after the final revision check. Interrupted/unknown locks remain blocked. See [ownership validation](settings-ownership-validation.md). | Stop the settings writer before external edits. Windows, storage-failure and hostile/shared-filesystem certification remain separate; no shared CLI lock is claimed |
| R02 | Q51–Q60 are delivered: independent pricing writer, archive-plus-publication activation, manual reader load, per-response active-basis verification, separate metadata warnings and guarded manual repair. Interrupted repair markers prevent premature cost recovery. | [Pricing ownership validation](pricing-ownership-recovery-validation.md). External editors must stop the writer; the archive is not a tamper-proof or power-loss-certified ledger |
| R03 | Q40–Q50 resource targets remain satisfied after Q51–Q60. The latest 35309532-byte CSV adds at most 2.02 MiB observed RSS during transfer; its full preparation/transfer sequence reaches 510.1 MiB. [Latest acceptance](pricing-ownership-recovery-validation.md) retains the measurement limits; [native delivery](query-export-performance-validation.md) retains saved-byte and cancellation evidence. | Real distributions, arbitrary capacities, concurrent refresh memory, true peaks and cross-platform limits remain unverified |
| R04 | Scan membership/fingerprints and dirty generations establish a stable admitted pass, not an atomic filesystem-wide snapshot or guaranteed delivery of every OS watcher event. | Exercise remaining scan/watch failure paths before changing this policy |
| R05 | Checked-in commits and isolated acceptance do not establish the code loaded by a running production process or a released artifact. No production rollout was certified. | Choose a separate controlled rollout/restart and packaged-artifact validation scope |

## Validation gaps

| ID | Not yet established | Concrete follow-up |
| --- | --- | --- |
| V01 | Windows filesystem/hard-link/rename permissions, recursive watcher and the supported Node-version matrix | Run the focused commands in each checkpoint on the required targets; do not infer Windows behavior from macOS |
| V02 | Live quota endpoints, real read-only CLI login changes and release-check endpoint behavior; general future pricing document compatibility | A read-only OpenAI pricing GET parsed 40 rows during the [2026-10-02 follow-up](month-pricing-remote-validation.md); this does not certify ongoing compatibility or the live cache. Other checks must preserve fixed endpoints and credential privacy; dashboard OAuth refresh is removed |
| V03 | Populated real Provider-log variants beyond the synthetic identity/cumulative/turn cases | Validate sanitized representative logs without exporting transcripts or credentials |
| V04 | Settings-save disk-full/denied-write behavior, interrupted settings replacement and incomplete owner acquisition/retirement; physical durability | Pricing write/rename/metadata failures and publication-stage SIGKILL now have evidence. Settings ownership loss and stale-lock recovery are also tested, but do not establish every write-stage failure. Use disposable paths and injected errors; actual disk exhaustion and power loss need a separate scope. Credential writes are removed |
| V05 | Actual watcher error emission, worker exit without a message, symlink-swap/deletion timing, partial append and empty-directory edge cases | Build focused isolated cases. Active worker termination, same-size restored-mtime replacement, in-flight writes, dirty follow-up and root recovery already have evidence |
| V06 | General concurrent-load responsiveness, other browsers, second-device LAN access and HTTPS tunnel end-to-end behavior remain unverified | [Stream validation](query-export-performance-validation.md) covers native delivery. [Remote follow-up](month-pricing-remote-validation.md) covers same-machine IPv4 LAN and IPv6 destination checks; two registered Quick Tunnels had ENOTFOUND. Q63 defers tunnel compatibility; no general concurrent-load SLA is claimed |
| V07 | Forced colors and assistive technology | Perform desktop-only interaction checks; prior geometry and AX evidence alone do not certify these modes |

No gap above is reported as a newly reproduced defect. Native Service/Tray remain unsupported/deferred, rather than a tested shipping feature. The source contract harness remains skipped because it can fetch upstream prices and write source caches; isolated route fixtures provide the bounded HTTP evidence.

## Product decisions that remain separate

Manual browser updates are already selected by Q20; automatic watcher-to-browser synchronization needs a new decision. Historical effective-rate pricing, archived-version activation and archive cleanup are separate from the delivered current-basis/read-only/permanent-retention policy. Observation pagination/table is outside Q27's count-and-prompt scope. Deprecated /api/summary retains all-snapshot totals with filtered Session rows for compatibility; changing or retiring that contract needs a separate decision. Q34–Q39 settle credential and settings ownership; Q51–Q60 settle pricing ownership and recovery; Q40–Q50 resource targets are delivered at the selected local workload.

R01 and R02 are closed within the selected cooperating-process policies; their external-editor and physical-storage boundaries remain. R03 meets the selected workload targets. These are completed scopes, not reasons to reselect credential, pricing or download policies.

## Next decision candidates

| Order | Bounded next scope | Evidence needed before any correction | Decision boundary |
| --- | --- | --- | --- |
| 1 | V04 isolated storage failures | Preserve exact old/new settings bytes, report failure, retain UI edits, inspect temporary/lock state and restart at selected write stages | First select injected disk-full/denied-write and process-interruption scope; do not exhaust the real disk or imply power-loss durability |
| 2 | R04/V05 scan and watcher edge cases | Observe failed-refresh rollback, visible status, bounded retry and recovery after controlled watcher/worker/path faults | Preserve whole-refresh rollback and manual browser updates; any new policy needs a decision |
| 3 | V03 representative log validation | Compare sanitized real format samples against adopted observations, model totals and uncertainty reasons | Real samples need an explicit privacy/source scope; synthetic probes alone do not close this gap |
| Separate | V01/V02/V06/V07 and R05 | Required platform/browser/assistive capabilities, fixed live endpoints or a reviewed rollout artifact | Select the target and access first; unsupported platforms and unrun live actions stay unverified |

This order is a recommendation, not authorization to start another implementation. Historical-rate accounting, observation pagination, automatic browser synchronization and legacy API changes remain optional product decisions.

## Inventory verification

This pass checked source/test anchors for active-basis verification, pricing actions, legacy-summary semantics, worker exit handling, scan rollback, settings persistence and ownership recovery. It cross-checked saved Q34–Q60 reports and current test names. FA01–FA24 remain unique; R01–R05 and V01–V07 remain traceable. Documentation links and git diff --check passed. No test suite, browser QA, production request or product-state mutation was repeated for this documentation-only inventory. Existing reports remain the runtime evidence; this pass does not count their overlapping checks as a new suite.
