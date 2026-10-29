# Gate: backend 8e93197 (M4.5.1 + M4.5.2) — Robin, 2026-10-28

**Verdict: PASS (P3 findings only). Not deployed; superseded by e0383b0 (steer 9:54).**

## Checks
- vitest 348/348, forge 54/54, tsc, lint, fixtures:check, npm audit 0.
- g5d5 PoCs: all 9 FINDING assertions now flip (fixed). New probe `qa/poc/robin-g8e9-m451.test.ts` 38/38 (locks, epoch bump on kill/disable, belt check, reconcile, alert semaphore, DNS 3 s timeout, previewFailedAt 60 s cache, pricesPhrase).
- Local integration with web a07a90b/3619bfe: landing notice follows the price source (Chainlink phrase), sign-in, backtest, run and stop, replay, portfolio, autopilot kill → 0 live runs.
- No deadlocks or lock leaks found.

## Findings (owner Sage, all P3)
1. Kill HTTP waits behind a stuck price fetch (abort signal not passed through). The flags flip immediately.
2. `stepAll` runs users one after another: one stuck user stalls every pass.
3. If `stop()` throws during a kill, the API returns 500, the run stays live, and nothing is logged.
4. `stop-api.cmd` needs OPS_TOKEN pre-set by the operator, and the token appears on curl's command line (visible in the process list).
