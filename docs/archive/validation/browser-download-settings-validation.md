# Native download and settings leave validation

Date: 2026-10-01 (Asia/Taipei). Platform: macOS, Node v26.0.0, native Safari desktop window (3024 x 1708 screenshot). This is a validation checkpoint. No product code change was required by the observed cases.

## Isolation and capability

The in-app browser's earlier download-completion event timed out. That unchanged method was not repeated. Native Safari exposed Save As, its completed-download list, and the browser's beforeunload dialog through the supported computer-use API.

Run `node tests/phase4-http.mjs --serve`. This copies the shipped server and assets to a temporary app, creates 251 synthetic Sessions, blocks external fetches, and uses isolated settings and absent test credentials. The HTTP acceptance checks passed before the desktop server stayed open. This run used localhost port 53981. Native browser actions used one new tab; the six existing user tabs were preserved. Stop the fixture with Ctrl+C.

All downloaded files contain synthetic data. The source checkout's configuration, credentials, pricing caches and production listener were not changed. Only MAX_FILES was saved in the temporary app. No security or network settings were changed.

## Actual file downloads

The browser showed the all-time UTC query with search fixture-250: one Session, one input Token, and USD 0.00001 under a synthetic rate of USD 10 per million input Tokens. Snapshot 3 and pricing revision 21fba515082e88cdcf4ef91978cff26c49839e0eab6549cc0f83ac894eb102f9 were displayed and exported.

Each format was selected through the page UI, downloaded through Save As, and saved to a dedicated test artifact directory. Safari's download list showed all four completed files. The actual bytes were compared with the corresponding export API response using the saved projection key and projectionAt. All four matched exactly.

| File | Format | Bytes | Result |
| --- | --- | ---: | --- |
| TEST_ONLY-session-export.csv | Session CSV | 1167 | Exact API byte match; one data row with query and version metadata |
| TEST_ONLY-trend-export.csv | Trend CSV | 1010 | Exact API byte match; one data row |
| TEST_ONLY-report.json | JSON report | 19760 | Exact API byte match; one matched Session and one Token; complete pricing basis |
| TEST_ONLY-summary.md | Markdown summary | 9010 | Exact API byte match |

A separate Save As attempt used TEST_ONLY-cancel.csv and Cancel. The sheet closed, the Download button remained enabled, and that file did not exist. The page stayed open. This checks browser save cancellation; it does not claim cancellation of an in-flight server request.

After the browser loaded snapshot 3, the fixture's advance command published snapshot 4. Clicking Download showed the version-change notice and reloaded the complete dashboard. No Save As sheet opened and no automatic second download occurred. A new user download action remained necessary.

## Settings leave behavior

Changes used actual keyboard typing and Tab so the form received native input/change events. An accessibility setValue operation alone did not establish those events and was not used as dirty-state evidence.

| Action | Observed result |
| --- | --- |
| Change Maximum files from 1000 to 999; Back to dashboard | The app's Unsaved changes dialog opened |
| Keep editing | The dialog closed and 999 remained in the form |
| Reload with unsaved 999; Stay on Page | Safari's native warning appeared; cancel kept 999 |
| Back; Discard and return | Dashboard opened with no second native warning; reopening settings showed persisted 1000 |
| Change to 998; Reload; Leave Page | Reload completed and restored persisted 1000 |
| Change to 999, then back to 1000 | No unsaved changes state returned |
| Change to 997; Save to .env | Success status and No unsaved changes appeared; GET /api/settings returned MAX_FILES=997 |
| Reload after save; Back to dashboard | No warning appeared; reloaded settings retained 997 |

The settings page was the copied app at localhost:53981/settings.html. No production settings were saved. The test tab closed without a dirty-form warning; Safari returned to its six pre-existing tabs. The fixture process stopped and removed its temporary app.

## Evidence and limits

Local artifacts are in `/Users/ethan/.codex/visualizations/2026/09/30/01a0f0ef-7186-77c2-b30d-f4695955d901/`:

- native-download-completed.png: Safari's four completed downloads and the selected synthetic Session.
- native-settings-leave.png: the app's Keep editing / Discard and return dialog.
- native-settings-beforeunload.png: Safari's Stay on Page / Leave Page warning.
- native-download-conflict.png: the version-change notice after a stopped export.
- native-download-qa/: four saved files and verification.json with byte lengths, SHA-256 digests and the projection used for comparison.

Immediate Blob URL revocation did not break these Safari downloads. No speculative download helper change was made. Browser save completion is not reported by the product; the native download list and saved files provide this checkpoint's evidence.

This run covers native Safari in English on desktop. Other browsers, Windows, download throttling or interruption, very large files, assistive technology and forced colors were not tested. No browser extension, package or other software was installed. No production restart, live provider request, push or release occurred. The source contract harness was not run because it can fetch upstream prices and write source caches. No broad suite was repeated for this documentation-only checkpoint.
