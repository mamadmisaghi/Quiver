# Native VPS preparation gate — 29 October 2026

Scope: run the latest Quiver frontend as a native Node/Next server on the owner's Windows VPS, while retaining the current source and backend changes.

## Result

**Local native build and scoped checks PASS. VPS deployment BLOCKED by management authentication.** The old public preview is still running. No remote change, deletion, service restart or migration is claimed.

## Changes

- Added explicit `build:vps` (`next build`) and `start:vps` (`next start --hostname 127.0.0.1`) scripts. Set the web task's `PORT` to the established 4517; Caddy remains the public ingress.
- Enabled `cacheComponents` required by the existing cached public strategy, leaderboard and replay functions. Without it, the native build failed on all three `use cache` directives.
- Resolved four pending optional lifecycle-script decisions as false. esbuild/sharp native build permissions and dependency versions remain unchanged. Frozen dependency installation completed successfully.
- Recorded owner authorization, exact access failure, backup/replacement sequence, dedicated PostgreSQL requirement, loopback service addresses and HTTPS/authentication activation steps in the VPS replacement handoff.

## Verification

- Dependency installation: passed with unchanged frozen lockfile.
- Frontend TypeScript: passed.
- Existing preview integration checks: 21 passed (compiler semantics, draft persistence, actual synthetic rule evaluation, registry parity, visitor bridge, cookie isolation and rejection paths).
- Native Next.js 16.3.4 production build with live adapter, relative `/v1` API base and dev-login UI disabled: passed. Output contains the application routes, dynamic API handlers and partial-prerendered public pages.
- Diff whitespace checks: passed.
- No backend code changed in this slice. Prior backend scoped gate was 113 passed/1 skipped; full-suite baseline still had the five documented TLS/pinned-network failures, not claimed fixed here.

## Limits and required next step

The authenticated Windows management channel is not available. WinRM advertises Negotiate but rejected the supplied administrator credential, including the server-confirmed local-domain form. RDP cannot be operated with this conversation's available tools. Do not retry authentication indefinitely or weaken TLS/WinRM authentication to proceed.

Windows-specific dependency installation, runtime services, database/FFmpeg setup, private backups, retiring the old release, DNS/HTTPS, real Privy sign-in, provider calls and restart recovery on the real VPS remain unverified. Native source preparation does not satisfy the owner's request to replace the live deployment until these steps are completed.
