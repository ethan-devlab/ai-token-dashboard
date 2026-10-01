# Pricing ownership and recovery validation

Date: 2026-10-01 (Asia/Taipei). Policy checkpoint: 38e6d2d. Q51–Q60 are implemented under [the confirmed plan](pricing-ownership-recovery-plan.md). Work used copied apps, disposable files, synthetic logs/prices and blocked child fetch implementations. Production port 3333, real caches/settings/credentials, upstream services and releases were not used.

## Delivered behavior

- One app-directory pricing writer covers both Providers. Its canonical `.pricing.writer-lock/` lease is independent of settings ownership. Readers neither initialize nor fetch/write prices. Normal close waits for admitted work, then releases its generation. Additional processes stay read-only until restart; lost ownership blocks all later mutations. `--unlock-pricing` only recovers a confirmed absent same-host owner and has no force mode.
- Per-Provider initialization, refresh, load, repair and publication run in order before any awaited writes. A complete candidate is archived, atomically published through the version-1 cache, then activated. Failed writes leave the previous committed basis. Attempt metadata cannot publish a stale basis after a new commit. A manual action overlapping a skipped automatic check still fetches.
- Startup requires a valid current publication and matching canonical archive. It does not choose a historical record. Only an empty Provider store permits bundled initialization by the writer. An existing missing/damaged publication leaves Tokens available and costs unknown.
- Dashboard, Session page/detail, deprecated summary, reparse results and export preparation verify the active basis on disk. A failed verification changes pricingAvailable and therefore projection identity. Read requests do not repair. Prepared downloads keep admitted content. Version-list current status also verifies the active basis.
- Optional check metadata is separate from basis validity. A damaged or failed check record gives a warning and unknown archived check time while valid fees remain usable. The UI reports archived check time rather than presenting an untrusted attempt as a successful check.
- Manual load is available to writer and readers. Manual repair requires the writer and a complete previously verified basis, or newly fetched/validated fixed-source prices. Damaged publication, basis and check files remain in unique quarantine files. Valid bases are not replaced. A moved record that became valid is restored without replacement and stops repair with a conflict.
- A cache-adjacent `.repairing` marker guards interrupted/unpublished basis restoration. Affected new costs remain unknown in the writer, readers and restarted processes until publication and marker release succeed. A valid older retained revision outside the marker remains available. Repair can restore a known first archive time from the process's verified record; an unknown reconstruction uses the actual new archive time. Markers and quarantine files have no automatic deletion.
- Desktop controls show writer/read-only status, Load published rates and restricted Repair pricing archive. Current actions update the whole projection. Late Provider responses/errors cannot publish or leave busy controls active. English and Traditional Chinese failure text separates source, ownership, archive, publication and metadata failures.

The phase also fixes Claude refresh modifier serialization. The old rebuild path passed RegExp objects back into the string-only modifier parser. Complete serializable inputs now retain both multipliers and patterns through refresh and restart. No dependency or pricing engine was added.

## Focused checks

Implementation preceded test additions. The checks ran in bounded groups; repeated checks are not counted twice. There are 63 distinct focused cases:

| Command or case group | Result |
| --- | --- |
| `node --test tests/pricing-owner.test.mjs` | 10 cases passed: canonical aliases, one owner, normal/competing retirement, absent-owner manual recovery, active/foreign/permission/invalid/busy refusal, lost generation, unsafe paths, invalid CLI arguments and settings independence |
| `node --test tests/pricing-recovery.test.mjs` | 20 cases passed: both-Provider reader zero writes/fetches, explicit latest load, retained-basis failure, missing/corrupt startup, publication write/rename failure, operation order, offline repair, metadata separation, quarantine races/bytes, ownership loss before/after fetch, version-1 validation, first publication failure, close ordering, no automatic repair, Claude modifiers, pending repair across readers/restart and skipped-auto/manual overlap |
| `node --test tests/pricing-archive.test.mjs` | 7 cases passed: canonical revisions, immutable files, source-check metadata, archive-before-activation, unknown-cost qualifiers, retained recovery and published metadata failure |
| `node --test tests/export-stream.test.mjs tests/phase4-projection.test.mjs tests/request-races.test.mjs` | 22 distinct existing cases passed: exact bounded formats, admitted snapshot lifecycle, projection/CSV completeness, stale responses and channel ownership |
| `node --test --test-name-pattern='pricing refresh\|pricing markdown\|Claude pricing' tests/server-services.test.mjs` | 4 selected cases passed: source parsers, automatic cadence across restart, manual refresh and source-failure retention |

The former archive-only startup fixture now supplies a valid publication. This follows Q54; an archive alone no longer proves the active version. The older HTTP fixture now expects unknown cost when the entire active archive directory is unavailable, as required by Q55.

## Actual process and HTTP checks

`node tests/pricing-ownership-http.mjs` runs actual copied server processes on different disposable ports, sharing one app directory. It passed these 15 recorded groups:

1. Both Providers have one writer and one reader. Reader startup, automatic behavior, rejected refresh/repair and manual load leave pricing files byte-identical and make zero child fetch calls.
2. Active-owner unlock is refused and performs no fetch.
3. Writer publication and reader manual load update complete projections for Codex and Claude. Readers do not silently switch.
4. Failed publication retains old in-memory and restarted pricing; the separately archived candidate stays inactive.
5. Corruption is detected by every cost route. Tokens remain 10, monetary values become unknown, read files stay unchanged and the previously prepared report keeps its admitted cost.
6. Offline retained-basis repair preserves corrupted bytes and first archive time. Injected repair-publication failure keeps the reader unknown and rejects latest-load until the writer completes publication.
7. Check-metadata damage preserves valid costs and reports unknown check time.
8. Actual SIGKILL after immutable archive publication restarts with the previous published basis.
9. Actual SIGKILL after the cache temporary write also restarts with the previous publication.
10. Actual SIGKILL after cache rename restarts with the newly published basis.
11. Actual SIGKILL after quarantine retains evidence and unknown cost. A restarted process cannot infer trusted in-memory inputs; newly validated source data is required.
12. Normal release does not promote a running reader; restarting a process acquires the independent pricing lease.
13. Replacing the writer generation blocks later pricing writes/fetches while settings remain writable. After that process ends, explicit pricing recovery succeeds.
14. A competing listener exits without fetching or releasing another owner's generation.
15. A separate app that acquired its own leases but cannot bind releases both leases.

`node tests/settings-owner-http.mjs`, `node tests/stream-export-http.mjs` and `node tests/pricing-archive-http.mjs` provide additional copied-route checks for unchanged settings/credential safety, native guards/admitted plans/abort/retry and the updated archive availability policy. All passed. These are synthetic HTTP checks, not live upstream contract validation.

## Desktop evidence

Root used the Codex in-app browser at 1280×720. No mobile/tablet, subagent or production tab was used. Direct interactions confirmed writer versus reader controls, complete cost updates from $0.00015 to $0.00019, failed latest-load retention, unknown costs after active corruption, offline manual repair, metadata warnings with known costs and Provider switching while a delayed refresh failed. Both tested tabs had no console errors. Price controls returned to their current enabled/disabled state after completion or supersession.

Local evidence is under `/Users/ethan/.codex/visualizations/2026/09/30/01a0f0ef-7186-77c2-b30d-f4695955d901/`:

- `pricing-reader-loaded.png`: manual latest-load with the read-only controls.
- `pricing-reader-load-failed.png`: Traditional Chinese failed-load retention.
- `pricing-reader-unknown-zh.png`: active corruption, unknown check/cost and reader restrictions.
- `pricing-writer-repaired.png`: explicit repair and publication, with the retained first archive time.
- `pricing-metadata-warning.png` and `pricing-reader-metadata-zh.png`: known costs with separate metadata warnings.

Earlier query/export delivery already verified actual Safari Save/Cancel/Stop and exact saved file bytes. This phase preserves that UI and tests its newly admitted pricing boundary through copied HTTP fixtures; it does not claim another full native file matrix.

## Resource acceptance

[Raw evidence](pricing-ownership-performance-evidence.json) contains 63 sequential HTTP samples from the existing isolated benchmark, including 10000/50000/150000 observations, complete four-format exports, a >32 MiB CSV and 1–10000 pricing versions. Numeric assertions passed with the selected workload and method.

| 150000-observation operation | Observed | Target |
| --- | --- | --- |
| First dashboard | 1147.7 ms | ≤1500 ms |
| Warm dashboard | 163.1–166.7 ms | ≤250 ms |
| New model filter | 167.6 ms | ≤250 ms |
| Last Session page | 42.9–43.5 ms | ≤100 ms |
| Session detail | 2.5 ms | ≤100 ms |
| Session CSV preparation + transfer | 108.5 ms | ≤500 ms |
| JSON preparation + transfer | 82.6 ms | ≤500 ms |
| Trend CSV preparation + transfer | 123.1 ms | ≤500 ms |
| Markdown preparation + transfer | 45.9 ms | ≤500 ms |
| Normal sequence maximum observed RSS | 388.4 MiB | ≤512 MiB |

The large CSV contains 35309532 bytes and 501 lines. Fast transfer adds at most 2.02 MiB observed RSS; the delayed reader adds 0.05 MiB, takes 11433.8 ms and has 108 external samples. Both stay below the 16 MiB transfer target. Its preparation/transfer sequence reaches 510.1 MiB observed RSS. The 10000-version pages take 19.0–23.8 ms.

Observed RSS is the maximum of process samples before/at headers/after and external ps sampling. It is not the exact peak. Two warm repeats do not establish p95, general concurrency, browser rendering latency, live-log distributions, Windows behavior or a cross-hardware SLA. Existing fixed-buffer output and one-slot limits remain.

## Limits and assumptions

The existing available-Provider gate remains on pricing dashboard actions. The canonical lock coordinates cooperating dashboard writers; external file edits require stopping the writer. An interrupted guard remains conservative rather than guessing a completed repair. Quarantine retention is permanent and no force recovery is provided. Power loss, disk/controller durability, hostile/shared filesystem changes, Windows/Node matrices, live pricing documents, real logs and production rollout remain unverified.

The source contract harness was skipped because it can fetch live pricing and write source caches. The selected copied fixtures provide the required route evidence. Final syntax checks, local documentation links, diff review and intended staging passed before commit. No push, release, package install or production restart occurred.
