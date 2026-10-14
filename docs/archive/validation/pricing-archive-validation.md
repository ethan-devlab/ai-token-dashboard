# Pricing archive validation

Date: 2026-10-01 (Asia/Taipei). Environment: macOS, Node v26.0.0. Policies: Q28–Q33 in [pricing-archive-plan.md](../plans/pricing-archive-plan.md).

## Result

Current-basis recalculation remains. Distinct complete bases are archived before activation, with read-only provider-isolated APIs and no automatic deletion. The shared SHA-256 revision covers provider, source, currency, unit, sorted matching rules/aliases, effectiveFrom, rates, modifiers and estimate disclaimer. Observation dates do not change it. Patterns are reconstructed through the existing case-insensitive rule compiler. Archive format version 1 is separate from pricing observation dates.

The app stores immutable basis records under .pricing-archive/provider/revision.json and separate revision.check.json metadata. Exclusive UUID temporary writes and hard-link publication prevent overwriting a basis record. Check metadata uses atomic rename; older cache times cannot decrease a later checked time. Reads validate provider/schema, canonical basis and digest, and limit records to 1 MiB. Corrupt records are rejected rather than replaced. List responses read at most 100 selected records and report invalid entries without exposing their content. Directory enumeration still scales with the retained version count.

Initialization seals current valid cache or bundled data with actual first archive time and origin. A verified record remains usable if a metadata write fails. New fetched rates activate only after archive success; otherwise prior verified rates remain. With no valid archive for the current basis, available=false and every cost component is null, while Token totals remain available. Model/trend/Session/detail/report values agree. CSV cost cells are blank, pricingArchived=false, and partial pricing is explicit. Storage recovery can archive the retained basis before an upstream request, so network failure does not prevent that recovery. Empty-query costs also stay unknown until archive availability is established.

Projection identity uses the same revision and includes pricingAvailable. Check-only refreshes retain identity; changed bases or recovered cost availability invalidate guarded old projections. JSON/Markdown include a reconstructable complete basis. CSV adds pricingArchived before the terminal recordType column and references the same revision. Existing named columns retain their order. The desktop price area shows the current revision, verified archive link, first archive time, and failure state. Failed manual price refresh reloads the complete current projection to show reliable status without retrying the update or export.

## Validation

- Seven new pricing-archive checks passed: canonical revisions, complete conditions, immutable records, metadata time, restart, corruption/provider rejection, activation ordering, prior-rate retention, unknown-cost recovery, offline storage recovery, usable read-only archive, and reconstructable Claude multipliers.
- Ten existing projection/export checks passed.
- Six existing pricing service checks passed, with synthetic source documents and temporary caches.
- 56 accounting/client checks passed: 23 Phase 1 checks and 33 client checks. They cover shared costing, model projection, partial pricing, chart unknown values, and existing client behavior.
- node tests/pricing-archive-http.mjs passed against a copied app: real filesystem directory failures, initial unknown cost, recovery, one/two/three revisions, stable check-only guard, changed-basis conflict, provider isolation, invalid inputs, complete export, retained costs, and process restart.
- node tests/phase4-http.mjs passed: 251 unpaged exported Sessions, paging/detail/export conflicts, all four formats, relative-time pinning and changed-pricing conflict at the same usage snapshot.
- Root desktop QA used English at 1280px and Traditional Chinese at 960px. Initial cost was — with 10 Tokens in KPI/trend/model/detail. Unblock plus one UI price update recovered US$0.00009 and its archive link. A new blocked candidate retained that amount and revision with an explicit archive warning; the button returned to aria-busy=false. English labels were also checked. The 960px scroll width was 960px. No console errors were captured.
- Syntax and diff checks passed for changed modules and fixtures.

Proof: pricing-archive-unknown-960.png, pricing-archive-recovered-960.png and pricing-archive-retained-960.png under /Users/ethan/.codex/visualizations/2026/09/30/01a0f0ef-7186-77c2-b30d-f4695955d901/. Temporary tabs, viewport, child servers and copied files were cleaned. The first QA process had closed stdin; it was stopped and replaced with a TTY fixture to exercise storage transitions. One HTTP check initially used exact floating-point equality; it now compares monetary results within 1e-12. No product rounding behavior was changed for that assertion.

## Limits

Initialization uses the selected valid cache or bundled basis and its matching archive. It does not automatically select a different saved version when that basis cannot be sealed.

This is a local estimation-input archive, not an official historical rate ledger or a tamper-proof audit log. Active basis validity is verified at initialization/publication; external deletion after activation is not continuously monitored. Read-only lookups detect missing or corrupt files. Concurrent processes have no shared lifecycle lock; immutable basis publication is exclusive, while check metadata/cache pointers use last-writer replacement. Cache persistence failure is reported separately and can restore the older cache on restart. No power-loss durability, filesystem permission, or cross-process race certification is claimed.

Windows hard-link/rename behavior, other Node versions, Service/Tray and real upstream contracts were not checked. Live pricing was not fetched or certified. The source contract harness was skipped because it can update source price caches. No real cache migration, production rescan/restart, settings/credential write, dependency installation, push, deployment or release occurred. No mobile/tablet QA was performed.

Windows-local reproduction: node --test tests/pricing-archive.test.mjs tests/phase4-projection.test.mjs; node tests/pricing-archive-http.mjs; node tests/phase4-http.mjs. HTTP fixtures require Node 18.19+ for --import. For desktop QA run node tests/pricing-archive-http.mjs --serve in an interactive terminal. Use unblock/block then the UI price-update action; stop with Ctrl+C.
