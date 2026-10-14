# Pricing basis archive plan

Date: 2026-10-01 (Asia/Taipei). Status: Q28–Q33 implemented and validated. See [pricing-archive-validation.md](../validation/pricing-archive-validation.md).

## Decisions

| Decision | Confirmed behavior |
| --- | --- |
| Q28 | Keep current-basis recalculation and add complete basis archives. A historical effective-rate ledger is separate work. |
| Q29 | Create a revision only when the calculation basis changes. Check times are separate metadata. |
| Q30 | Activate new fetched rates only after successful archive persistence. On failure, retain a usable former basis and report failure. |
| Q31 | Provide read-only archive APIs, complete basis export, and current revision information in the existing price area. Do not add revision selection or recalculation with an old revision. |
| Q32 | Keep all archived revisions. Do not delete automatically. Any cleanup requires a separate explicit decision. |
| Q33 | When no valid archived current basis exists and persistence fails, keep Token analysis available but mark cost as unknown. A previously verified archived basis can still be used. |

Archive the current basis on first enablement, whether it came from bundled rates or a valid existing cache. Record actual first archive time and origin. Do not backdate archive creation to a model effective date or a previous check. Versions that were not previously saved cannot be reconstructed as trustworthy history.

## Baseline evidence at 3d08be6

- server/pricing-refresh.mjs replaces same-model rates, preserves old rule effectiveFrom values, assigns an observation date to newly discovered models, and keeps one version-1 cache. Cached serialization includes rules and modifiers.
- server/pricing.mjs matches rules against event timestamps. Existing effectiveFrom values are not proof of a complete official historical rate ledger.
- server.mjs substitutes the current service basis at query time. A successful basis change recalculates selected historical events on subsequent queries.
- server/projection.mjs hashes rules, rates, modifiers, and updatedAt. updatedAt is an observation date and can change without changed rates. Q29 requires separating check metadata from calculation identity.
- server/dashboard-data.mjs exports rates, source, currency and unitTokens but omits complete rules and modifiers. Its hash alone cannot reconstruct the missing basis.

No live official prices were fetched for these findings. They describe current project behavior, not the correctness of its upstream prices or effective dates.

## Implementation boundary

1. Add a shared, deterministic basis serializer and revision function. Include provider, source, currency, unitTokens, normalized matching rules, rates, effectiveFrom, modifiers and estimate conditions. Exclude observation/check times. Serialize regex source and flags without executable code. Use the same revision in archive records and projection guards. A rules/effective-date/modifier change is a basis change even when raw rates stay equal.
2. Add provider-separated local archive storage under the app directory, with a versioned schema, exclusive temporary writes and atomic replacement. Validate schema, provider and basis digest on reads. Keep original first archive time; update check metadata without inventing a new revision. Do not expose paths, credentials, or transcript data. This is an immutable calculation basis with separate observation metadata, not a tamper-proof audit system.
3. Migrate the currently loaded cache/bundled basis by archiving it at enablement. Preserve existing valid cache compatibility. Persist a new candidate before publishing it. Keep an archived prior basis on failure. If none is usable, expose the failure and unknown cost while leaving Token queries available. A later successful archive operation must recover this state. Do not claim a shared cross-process lock or silently overwrite invalid evidence.
4. Provide bounded, provider-scoped read-only list/detail routes with strict revision and pagination validation. Show current revision and archive availability in the existing desktop price area. Keep automatic/manual refresh scheduling and no-history-selection behavior. An unchanged check must not invalidate a displayed calculation projection.
5. Include the complete serializable basis and revision in JSON/Markdown reports. CSV retains its existing columns and references the same revision; full basis is available through the version API. Keep empty-result metadata, partial pricing, snapshot guards, and manual conflict reload behavior.
6. Update API/plan/validation documentation and commit the finished checkpoint before starting further work.

Internal filenames and exact route schema will follow existing project conventions. No new dependencies, database, framework, settings migration, historical-rate inference, official bill calculation, revision switcher, automatic archive deletion, or live upstream certification is included. No production restart or real cache migration will be run during fixture QA.

## Acceptance scenarios

- Equal normalized basis with changed check time/date: one archived revision, stable calculation identity, retained first archive time, updated check metadata.
- Changed rates, matching rules, effectiveFrom, modifiers or unit: new revision before activation; selected KPI/trend/model/detail/export all use that revision.
- Provider isolation: Codex and Claude cannot read or claim each other's revisions; malformed revision/query is rejected.
- Restart: valid cache and archives restore the same complete basis. Read-only lookups retain old revisions. A known archive predates neither its actual creation nor its first recorded observation.
- New candidate write failure: prior archived rates remain active with explicit failure. No candidate revision is shown as successfully archived.
- First archive failure with no usable archive: Token counts stay correct; costs are unknown rather than measured zero. Successful later persistence restores known costs. All surfaces and export qualifiers agree.
- Corrupt or mismatched archive: reject that record; do not present it as verified. An invalid archive must not erase or corrupt other valid revisions.
- Missing historical rate: this phase continues current-basis estimation and explicitly identifies that basis. It does not assign archived observation time as official effective time.
- Full JSON/Markdown basis can be reconstructed and hashed to the same revision, including Claude multipliers. CSV current and empty metadata reference that revision.
- Existing guarded page/detail/export requests reject changed calculation bases, but equal-rate check-only refreshes do not cause false conflicts.
- Root desktop QA in English and Traditional Chinese confirms version/status information, retained-rate error and unknown-cost startup behavior. No mobile/tablet checks.

Implement first, then add focused basis/archive/service/projection/export checks and an isolated copied-server fixture with blocked external fetch. Do not run the source contract harness. Run syntax/diff checks, directly observe desktop behavior, record unavailable Windows/other Node/live validation, clean temporary fixtures, stage intended files, and confirm the commit.
