# Native VPS preparation gate — 29 October 2026

Scope: run the latest Quiver frontend as a native Node/Next server on the owner's Windows VPS, while retaining the current source and backend changes.

## Result

**Native Windows build PASS, reported by the owner. Production activation pending.** The owner returned `QUIVER_PREPARE_OK` for release `r-20261029-220200-88d8bf6f-6bf2906b`, Node v24.22.0, build ID `NHUMbCwCq09SoDmxtX13R`. Its `activated:false` means it has not replaced the old public preview. Inbound management authentication remains unresolved; bounded scripts run through the owner's existing RDP session provide the continuation path.

## Changes

- Added explicit `build:vps` (`next build`) and `start:vps` (`next start --hostname 127.0.0.1`) scripts. Set the web task's `PORT` to the established 4517; Caddy remains the public ingress.
- Enabled `cacheComponents` required by the existing cached public strategy, leaderboard and replay functions. Without it, the native build failed on all three `use cache` directives.
- Resolved four pending optional lifecycle-script decisions as false. esbuild/sharp native build permissions and dependency versions remain unchanged. Frozen dependency installation completed successfully.
- Recorded owner authorization, exact access failure, backup/replacement sequence, dedicated PostgreSQL requirement, loopback service addresses and HTTPS/authentication activation steps in the VPS replacement handoff.
- Added an owner-run PowerShell 7 preparation script for an independent Windows build while inbound management access remains unresolved. It pins both source commit and archive SHA256, uses private package-manager tooling and a new release directory, and records a build-only result without changing running services.
- Added a separate runtime initializer for private backups, a dedicated loopback-only PostgreSQL Windows service and restart probe, a separate Caddy HTTPS preparation page, and a server-held RSA deployment key. Provider values are absent from its source. It refuses to run over an activated production block or a launcher already pointing at the new release.

## Verification

- Dependency installation: passed with unchanged frozen lockfile.
- Frontend TypeScript: passed.
- Existing preview integration checks: 21 passed (compiler semantics, draft persistence, actual synthetic rule evaluation, registry parity, visitor bridge, cookie isolation and rejection paths).
- Native Next.js 16.3.4 production build with live adapter, relative `/v1` API base and dev-login UI disabled: passed. Output contains the application routes, dynamic API handlers and partial-prerendered public pages.
- Diff whitespace checks: passed.
- No backend code changed in this slice. Prior backend scoped gate was 113 passed/1 skipped; full-suite baseline still had the five documented TLS/pinned-network failures, not claimed fixed here.
- Preparation script parsed successfully with the official PowerShell 7.6.6 runtime. A real native child exit code 7 propagated as a terminating build-step failure. The non-Windows platform guard rejected local execution before touching any VPS path. These are Linux-side script checks, not a Windows execution.
- The 21 preview checks also passed with the preparation script's production/live environment flags. The downloaded pinned source archive matches the locally verified native runtime configuration.
- Runtime initializer: PowerShell 7.6.6 syntax passed, its native-command helper propagated a real child exit code 9, RSA private/public import/export passed, and its embedded database JavaScript parsed. The complete downloaded PostgreSQL archive matched the publisher SHA256 and its actual executable/DLL paths matched the script. These are preparation checks, not successful runtime execution on Windows.

## Limits and required next step

The authenticated Windows management channel is not available. The owner proved local WinRM authentication succeeds; the external client still receives 401 through its proxy, with no event matching its explicit workstation marker. The cause remains unresolved. The owner confirmed only an HTTP WinRM listener exists and the machine personal-certificate store returned no entries. RDP cannot be operated with this conversation's available tools. Do not retry authentication indefinitely or weaken TLS/WinRM authentication to proceed. The owner can run the prepared build script from the existing RDP session without enabling another management endpoint.

Windows dependency installation and builds completed according to the owner's preparation report. Runtime services, database/FFmpeg setup, private backups, retiring the old release, HTTPS, real Privy sign-in, provider calls and application restart recovery remain unverified. Native source preparation does not satisfy the owner's request to replace the live deployment until these steps are completed.
