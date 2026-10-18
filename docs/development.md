# Development and releases

[Documentation index](README.md) · [Architecture](architecture.md) · [API](api-v2.md)

## Focused checks

Use a disposable checkout with no running dashboard for HTTP tests. Some harnesses create app-local pricing and ownership files. Unit checks can run in the normal checkout.

```powershell
npm run check
npm run test:server
npm run test:client
npm run test:contract
```

CI uses three jobs: Ubuntu with the minimum Node 22.15.0, Windows with Node 24, and macOS with Node 24. Each runs syntax, server, client, HTTP contracts, fork accounting, and detail-limit checks. The workflow supports manual dispatch, read-only repository permission, and cancellation of superseded runs. There is no dependency installation or audit step because this project has no package dependencies or lockfile. Select ownership, pricing, calendar or export harnesses only when a change affects that surface; see the archived validation records for commands and limits. Desktop visual checks are manual and stay desktop-only.

## Documentation maintenance

Keep current behavior in the topic guides and API reference. Put dated investigations, plans, benchmarks and validation records under archive. Link them from the archive index instead of appending incident timelines to the user guides. Update local links when moving files. Preserve accepted decisions and evidence; a historical successful check is not a claim that it ran again.

## Releases

Push a matching `vX.Y.Z` tag after CI passes to create a source ZIP, `SHA256SUMS`, the migration guide, and provenance attestation. Release descriptions use the hand-written `docs/releases/vX.Y.Z.md` when present, without generated commit lists; otherwise they use the migration guide. The release job uses Node.js `24.13.1`. Version 1.0.0 restarts release numbering without reverting features; older 2.x/3.x installs require manual installation. Verify a downloaded archive before extracting:

```powershell
Get-FileHash .\ai-token-dashboard-vX.Y.Z.zip -Algorithm SHA256
gh attestation verify .\ai-token-dashboard-vX.Y.Z.zip -R ethan-devlab/ai-token-dashboard
```

The package version in package.json is the application version returned by the server. Update it as part of an intentional release; usage snapshots and pricing revisions have their own identities. The header remains unknown if the server cannot supply its version.

New releases use ai-token-dashboard-vX.Y.Z.zip with an ai-token-dashboard-vX.Y.Z/ directory prefix. Existing releases retain their original filenames and digests; verify the actual downloaded file against its release checksum and attestation. The update checker accepts assets under either naming scheme. No tag or release is created by changing the package name.
