# Gate — Render continuation, 2026-10-29

Scope: explicit Frankfurt placement, direct Node Docker entrypoint, configured vision-model routing assertion. Source baseline: `704eab95b2025ed397db63f009f266c83999aa09`.

## Result

**Scoped checks PASS; publication remains blocked on dashboard access and live verification.** This is not an all-green full-suite or production acceptance claim.

## Evidence

- Backend TypeScript and production bundle passed.
- Targeted checks: 113 passed, 1 skipped, 21 files passed. Includes provider budget and persistence, paper storage, auth, chart compiler, shutdown and selected regression tests.
- Full suite: 552 passed, 5 failed, 9 skipped; 80 files passed, 2 failed, 2 skipped.
- Existing failing groups: `test/integration/m421.test.ts` (4 local TLS/pinned-network tests), `test/integration/m513.test.ts` (1 local pinned RPC timeout). No security settings or transport code changed.
- Current Render JSON Schema accepts the updated Blueprint under YAML 1.2 semantics.
- Existing Docker shell entrypoint ends with `exec gosu node "$@"`; image CMD now names Node directly, preserving signal delivery to `installShutdownSignals`.
- API and database share explicit `frankfurt`; replay disk, single instance, manual deploys, private-only database access, readiness path and mainnet-disabled settings are retained.
- No live resources, frontend environment, credentials, wallet transactions or audience settings changed.

## Outstanding checks

Actual Docker build; Render Blueprint application and deployment; actual PostgreSQL transport and restart recovery; Privy login and allowed origin; frontend live bridge and full authenticated paper workflow; diagnosis of the five network-test failures on a suitable host.
