# Upgrade to v3.0.0

## Breaking requirements

- Node 18 and Node 20 are no longer supported. Use Node 22.15.0 or later in the 22.x line, Node 23.8.0 or later in the 23.x line, or Node 24 or later. Earlier Node 23 releases lack the required built-in Zstandard API.
- Billable usage with no known price now returns null monetary amounts instead of zero. API clients must keep these values unknown. CSV cost cells are blank; Markdown reports unknown.
- Historical cost estimates now use the current retained rates for all event dates. Rule effectiveFrom values remain as provenance and no longer exclude older usage. These are API-equivalent estimates, not historical bills.

## Restored historical usage

Codex discovery reads both .jsonl and Zstandard-compressed .jsonl.zst files under CODEX_SESSIONS_DIR. Earlier releases ignored compressed files, so older periods could appear empty. Historical totals can increase after this upgrade.

Decompression is streamed with the built-in Node API, which Node currently labels experimental. No dependency installation or external decompressor is required. Source files are not modified or extracted to disk. Compressed files count toward MAX_FILES. Dates use event timestamps, not filenames or modification times. Identical decoded content uses the existing Provider/Session deduplication policy. Invalid or truncated frames reject the complete refresh and retain the prior snapshot. The separate Codex archived_sessions directory is not added automatically.

## Cost and integration changes

- Mixed priced/unpriced usage shows its known subtotal with a lower-bound marker. Fully unpriced usage shows Cost unknown; empty usage and confirmed free usage remain zero when a verified basis is available.
- A valid basis with entirely unpriced usage returns cost.available=false, cost.unavailableReason=unpriced-usage, and pricingCoverage.ratio=0. A missing/invalid basis uses cost.unavailableReason=pricing-basis and ratio=null.
- KPI, trend, model, Session, detail and export amounts use the same rules. Unknown rates, unsupported cache durations and unknown modifiers remain unpriced.
- Legacy Claude records with missing speed or missing/`not_available` geography use the standard-rate lower bound when the service tier is explicitly standard. Supported geography and speed modifiers only add surcharges. These estimates remain partial (`≥`); explicit unsupported modifiers or an unknown service tier remain unpriced.
- API pricing.calculationPolicy and projection.pricingPolicy identify current-rates-all-event-dates-v1. CSV adds pricingCalculationPolicy; JSON and Markdown retain the full pricing basis and policy. CSV readers must select fields by column name and continue to distinguish recordType=data from recordType=metadata.
- Existing pricing archives and their revisions are preserved. The calculation policy identifies this change separately from the retained fee rules. No historical billing ledger or historical-rate switch is introduced.
- On writer startup, a valid pre-archive price publication without a revision is migrated once when its archive is empty and no repair is pending. Its rates and check time are retained; migration needs no network request. Revision-bearing publications with missing or damaged archives still require explicit repair.

## Upgrade steps

1. Check node --version and install a supported runtime if needed.
2. Download ai-token-dashboard-v3.0.0.zip. Verify its SHA-256 against SHA256SUMS and verify its GitHub provenance attestation before extraction.
3. Stop the old dashboard normally. Keep a local backup of its application directory, including .env and app-local pricing data. Keep the Session source directories unchanged.
4. Extract the new source into the application directory while retaining the existing .env and app-local pricing data. Do not copy new source over a running service. No dependency installation or build is required.
5. Run npm start. Confirm the header reports v3.0.0, check an older period and inspect pricing coverage. Browser preferences remain available under their existing keys.

The HTTP API routes remain unchanged. Local Host/Origin protections, independent writer ownership, pricing verification and refresh rollback remain in effect. This is a source archive; it does not install a service or start the dashboard automatically.

## Rollback

Stop v3 normally and restore the prior application backup and compatible runtime. This release does not migrate or rewrite Session files or archived pricing rules. Older releases can again omit compressed history and exclude older usage from pricing; their totals can differ. Existing published releases and checksums remain unchanged.
