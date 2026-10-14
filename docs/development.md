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

CI runs syntax/server checks on Ubuntu with the minimum Node 22.15.0, and client/HTTP contract checks on Windows with Node 22. A local macOS pass does not establish Windows filesystem or watcher behavior. Select ownership, pricing, calendar or export harnesses only when a change affects that surface; see the archived validation records for commands and limits. Desktop visual checks are manual and stay desktop-only.

## Documentation maintenance

Keep current behavior in the topic guides and API reference. Put dated investigations, plans, benchmarks and validation records under archive. Link them from the archive index instead of appending incident timelines to the user guides. Update local links when moving files. Preserve accepted decisions and evidence; a historical successful check is not a claim that it ran again.

## Releases

Push a matching `vX.Y.Z` tag to create a source ZIP, `SHA256SUMS`, v2.1 migration notes, and provenance attestation. The release job uses Node.js `24.13.1`, matching the local release runtime used for this project. Verify a downloaded archive before extracting:

```powershell
Get-FileHash .\ai-token-dashboard-vX.Y.Z.zip -Algorithm SHA256
gh attestation verify .\ai-token-dashboard-vX.Y.Z.zip -R ethan-devlab/ai-token-dashboard
```

The package version in package.json is the application version returned by the server. Update it as part of an intentional release; usage snapshots and pricing revisions have their own identities. The header remains unknown if the server cannot supply its version.

New releases use ai-token-dashboard-vX.Y.Z.zip with an ai-token-dashboard-vX.Y.Z/ directory prefix. Existing releases retain their original filenames and digests; verify the actual downloaded file against its release checksum and attestation. The update checker accepts assets under either naming scheme. No tag or release is created by changing the package name.
