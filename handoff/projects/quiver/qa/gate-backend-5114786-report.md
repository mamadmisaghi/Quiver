# Gate: backend 5114786 (Sage M3.7 + M3.8). Verdict: PASS. Deployed with web a07a90b.
Gated by Robin on 2026-10-28 (Asia/Tehran). Diff reviewed: 7f3c831..5114786.

## Automated checks
- vitest: 223/223 passed.
- forge: 54/54 passed.
- fixtures:check: up to date (tree clean).
- lint: OK.
- tsc (root and contracts): OK.
- npm audit: 0 vulnerabilities.
- Robin probe suite (test/integration/robin-m37.test.ts, kept local, not committed): 13/13 passed.

## P3 checks
- **State load:** a newer valid .tmp wins. An older or corrupt .tmp is ignored with a "load failed" warning and cleaned up. Checked against a real process.
- **Graceful shutdown:** SIGTERM, SIGINT and POST /v1/ops/shutdown (202, exit 0) each flush state.json, and runs persist.
- **Ops routes:**
  - With OPS_TOKEN unset, every route returns 404.
  - Token check is sha256 plus timingSafeEqual.
  - Wrong, prefix, case-variant, space-variant and lowercase-"bearer" tokens all get 401. A user JWT is rejected.
  - Limit is 30/min per IP, applied before the token check; then 429 with Retry-After.
  - The runs routes return 404 in production or on chain 4663. Live runs are hidden and can't be stopped.
  - Stop is idempotent.
  - The token appears in no log, audit entry, response or ConfigError; describeConfig shows it only as "set".

## New routes
- **/v1/public/landing:** no auth needed. Cache-control is `public, max-age=60`. Limit is 60/min, then 429. The preview is cached, and there are no private fields.
- **/v1/settings:** needs auth. Returns liveEnabled=false and modes=["paper"].
- **Stop-all:** stops only the caller's runs; another user's run stays running.
- **Card:** owner gets 200. Another user gets 404 with the same message as a missing run. A guest gets 401.

## Notes (P3, not blocking)
1. Stop-all skips live runs; live is off for now.
2. If the landing preview fails, the null result is cached for an hour.
3. Ops routes are publicly reachable through :8091, gated by the token and the 30/min limit. Consider blocking /v1/ops at Caddy.
4. The landing notice says "synthetic (mock) prices" even though the VPS uses mainnet-readonly prices. This is a copy fix.
5. stop-api.ps1 defaults (8787 / QuiverAPI) don't match the VPS (8987 / QuiverApi), and PowerShell is broken on the VPS.
