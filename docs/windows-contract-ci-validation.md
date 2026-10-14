# Windows contract CI correction

Date: 2026-10-14 (Asia/Taipei). Failed source: d26082c. Evidence: [CI run 38538266295, windows-contract job](https://github.com/ethan-devlab/codex-token-dashboard/actions/runs/38538266295/job/115766400721).

## Failure and correction

The Windows job used Node v22.23.3. It failed in `npm run test:client`: 30 passed and three failed. The sub-micro-dollar, model-rank and overview-cost assertions expected `≥ $1E-8`; the formatter produced `≥ $1.00E-8`. The following contract step was skipped; the Ubuntu Node 18 job passed.

The scientific currency formatter specified maximumFractionDigits=6 but left the minimum implicit. A verified official Node v22.23.3 binary on macOS reproduced minimumFractionDigits=2 and $1.00E-8. Node v26.0.0 resolved the same options to minimumFractionDigits=0 and $1E-8. The fix sets minimumFractionDigits=0 explicitly. The existing exact assertions remain; an additional fractional-mantissa assertion checks that useful digits remain.

After this fix, isolated Node 22 HTTP validation exposed an older contract assertion: unavailable account usage now includes checkedAt, while the assertion expected the old shape. The updated assertion checks the current complete object, fetchedAt=null and a canonical ISO checkedAt timestamp. No account-usage implementation was changed.

## Completed validation

- Node v22.23.3 on macOS: all 33 client tests passed, including the three failing CI assertions.
- Node v26.0.0 on macOS: all 33 client tests passed.
- Node v22.23.3 on macOS: all three HTTP contract tests passed in a temporary copied application. Only local test fetches were permitted; external fetches returned a controlled unavailable response. The real .env, ownership locks, pricing stores and service were not used.
- `npm run check`, formatter syntax and `git diff --check` passed.

Node 22 was downloaded temporarily from nodejs.org for the exact CI version and checked against its official SHA-256 manifest. No global runtime or dependency was installed. Temporary applications and runtime files were removed. The first sandboxed HTTP attempt could not bind (EPERM); the isolated check was rerun with local-listener permission. An initial offline wrapper also intercepted local fetches, causing fixture 503 responses; it was corrected to pass through only the test's loopback requests. Neither harness issue is classified as an application failure.

Windows hardware and the corrected remote GitHub job have not yet been run. On a Windows checkout with Node 22, run `npm run test:client` and `npm run test:contract`; the existing windows-contract workflow runs both after push. No workflow, pricing, ownership, security policy or live-service restart was changed.
