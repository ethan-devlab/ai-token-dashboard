# v2.0 to v2.1 migration

The product name is Local AI Token Dashboard. The package and repository name are now `ai-token-dashboard`: [ethan-devlab/ai-token-dashboard](https://github.com/ethan-devlab/ai-token-dashboard). Archived records can still use the former repository name.

- Existing API calls without `provider` still select Codex.
- Add `CLAUDE_SESSIONS_DIR` only when the default `~/.claude/projects` path is not correct.
- The provider dropdown stores its last selection locally. A `provider` URL parameter takes precedence.
- Existing local budgets migrate once to Codex. Claude budgets are separate.
- Claude subagent sessions are included by default and can be excluded with `executionType=main`.
- Claude cost is an Anthropic API-equivalent token estimate. It is not a Pro or Max subscription bill and excludes non-token tool fees.

## Clients using earlier v2.1 source

| Surface | Current client action |
| --- | --- |
| Update checks | Use body-free same-origin POST /api/update. GET returns 405 without checking GitHub |
| Settings | GET the current revision, then save with quoted If-Match and exact Origin. Missing versions return 428; stale versions return 409 |
| CSV readers | Count only recordType=data. Empty results retain one recordType=metadata row with blank measurements |
| Paging/detail/export | Use displayed projection and clock guards; a conflict requires a full reload and a new download action |
| Downloads | Use native prepared streaming. No fixed 32 MiB cap or Range resume is provided |
| Startup ownership | Restart can recover a verified absent same-machine owner. Running readers remain read-only; uncertain locks remain blocked |
| Application version | GET /api/providers adds version from the running package; existing providers remains unchanged |

See [API](api-v2.md), [operations](operations.md) and [security](security.md) for full semantics. These source compatibility notes do not imply that every change was published as a tagged release.

## Repository rename compatibility

The default update source and new-release ZIP prefix use ai-token-dashboard. Existing .env values still take precedence; change the former official repository value explicitly if desired. Blank/custom update sources are preserved. Existing published archives are not renamed or reissued. Browser preference keys retain their legacy codex-token-dashboard namespace so saved language, Provider, budgets and view settings remain available. The application version stays unchanged by the name change.

## Compressed Codex history in newer source

Node.js 22.15.0 or later is required. Node 18 is no longer supported. The reader includes `.jsonl.zst` files under the configured Codex sessions root, using the built-in Zstandard API (currently experimental in Node). No dependency or external decompressor is required. Source files are not changed or extracted to disk. Historical totals can increase because earlier source skipped compressed files. Dates still use usage event timestamps, not filenames or file modification times. Identical decoded content uses the existing Provider/Session deduplication policy. Decode or frame-completeness failures retain the previous complete snapshot. The separate Codex `archived_sessions` directory is not added automatically.

## Current-rate calculation correction in newer source

The current verified rates apply to usage before a rule's effectiveFrom date. That date remains in the archive as provenance; it is not a billing cutoff. Existing archives are retained without rewriting their rules or revisions. Responses and exports add the calculation policy current-rates-all-event-dates-v1; CSV adds pricingCalculationPolicy. Historical cost estimates can increase. If billable usage is entirely unpriced, monetary amounts are now null rather than zero, with unavailableReason=unpriced-usage and coverage ratio=0. Clients must keep null costs unknown. Mixed usage keeps the known subtotal; empty usage and confirmed free usage keep zero. The no-archive state uses unavailableReason=pricing-basis and keeps ratio=null.
