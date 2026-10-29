# Robin QA re-gate — Quiver backend M3.5 @ 19e4ba1
Date 2026-10-27 (Asia/Tehran, UTC+3:30). Verdict: **PASS** (backend). 0 P0, 0 P1 open; P2 items below. SessionAccount stays UNAUDITED / local-only.
Isolation: /tmp/robin-b5 worktree (backend), /tmp/robin-w5 (web f8c8da2, clean `npm ci`), ports 8798/8799/4419; only my session PIDs killed.

## Numbers (reproduced independently)
| Check | Result |
|---|---|
| vitest | 21 files, **174/174** |
| tsc (root + contracts) | 0 errors |
| lint (`lint:install` then `lint`) | clean |
| npm audit | **0 vulnerabilities**; zod ^4.6.7 in backend + contracts |
| forge (Sage) | 29/29 |
| forge (Robin, test/RobinV2.t.sol, independent) | **19/19** — 7 v1 PoCs hand-ported now blocked + 12 new probes |
| slither | 16 results, 0 actionable high/med (uninitialized-state on `spends` = false positive, it's a pushed storage array; divide-before-multiply in `_floor` = rounds floor down, conservative) |

## P1 verification (own probes: qa/poc/m35-probes.mjs → m35-probes-out.json, m35-sse-release.mjs)
- **Backtest ranges ✅** to=now+60s 422 `future`; future-only 422; to=now−1s 202; from = UTC-midnight(now−365d) 202; that −1ms 422 `before_data`; 1970 422.
- **Run cap ✅** sequential 5×201 then 429 `limit_exceeded`; **race** 12 parallel starts on a fresh user → exactly 5×201 + 7×429; stop frees a slot (200 → next start 201).
- **SSE cap ✅** 10×200, 11th 429; abort frees the slot (200); **race** 20 parallel opens → exactly 10×200 + 10×429, and all 10 reopen afterwards (no leaked slots); stopping a run releases its streams.
- **Dev login ✅** default false; `NODE_ENV=production`+true → refused; `QUIVR_MODE=mainnet` or `CHAIN_ID=4663` +true → refused; `1`/`TRUE` → config error (fail closed). Gap: `NODE_ENV=Production` (case) is accepted → P2.
- **SessionAccount v2 ✅** (RobinV2.t.sol): non-allowlisted tokenIn → TokenNotAllowed; over per-tx → OverTxCap; minOut 0 → MinOutZero; minOut 1 → MinOutBelowFloor; 3×800 then +120s across UTC midnight → OverWindowCap, rolls off only after 24h; re-grant can't reset window; per-key nonce isolation; malleable high-s sig → BadSig; replay → BadSig; deadline passed → SigExpired; deadline tamper → BadSig; trailing bytes → BadCalldata; dirty address bits revert; stale / missing tokenOut feed / negative / future-timestamp oracle all revert; grant guards (dup token, past expiry, empty, wrong selector for Kind, non-owner setFeed).

## P2 verification
Single-use tickets ✅ (reuse 401 on both stream routes) · 404s ✅ (unknown routes 404 with/without auth, known routes 401) · security headers ✅ (nosniff, DENY, no-referrer, CSP none, CORP same-site, HSTS; also on 404) · rate map ✅ (RL_MAX 50k, prune) · refresh cookie ✅ Secure for non-localhost Host, exempt only mock+localhost · equity ✅ 100 & 10,000,000 ok; 99, 10,000,001, 0, −5, 1e24, abc → 422 · error leakage ✅ generic message, detail redacted to server log · versions ✅ only `1` 200; abc/0/99/1.5/−1/01/1e0 → 404 · zod/audit ✅.

## Remaining findings (all P2, owner Sage)
1. `NODE_ENV=Production` / `PRODUCTION` bypasses the dev-login refusal (contracts/src/config.ts:83 compares `=== "production"`). Fix: `.toLowerCase().trim()`, or better refuse dev login unless `QUIVR_MODE=mock && HL_NETWORK=testnet`.
2. Owner `setFeed` accepts any `maxAge` (e.g. uint32.max disables staleness, test_new_ownerCanDisableStaleness) and `maxAge=0`. Fix: bound 60s ≤ maxAge ≤ 24h; also check `answeredInRound` and an L2 sequencer-uptime feed before mainnet.
3. Floor is oracle-only: up to `maxSlippageBps` (≤10%) of each swap is sandwichable, so a leaked key can leak ≤~10% of windowCap per 24h (test_new_maxSlippageTenPercentAccepted). Fix/doc: default ≤100 bps in the app; document the bound.
4. 64-entry spend log: a leaked key can self-lock the session for 24h with dust swaps (test_new_spendLogDoS) — self-DoS only; document or count per-token per-amount.
5. Rate-map overflow evicts oldest buckets: with 50k distinct keys an attacker could reset others' counters. Low risk (keys are IP/user, IP not spoofable unless TRUST_PROXY); consider rejecting over capacity instead of evicting.
6. `access-control-allow-credentials: true` is sent even without an allowed Origin (harmless, tidy).
7. Contract still UNAUDITED; feeds unverified → swaps fail closed with OracleMissing until real feed addresses are verified. Not a gate item for paper/devnet.

## Web check (latest web commit f8c8da2, above 994f663)
Live /app/markets vs backend 19e4ba1 at 1440 and 390: **0 page/console errors, 10 rows, NVDA + JUP (jupiter_readonly) render, no overflow, not stuck loading** → previous P0 resolved. Shot: shots/robin/m35/live-1440-app_markets-f8c8da2.png (+390). Note: Wren's working tree has uncommitted changes and zod 4.6.7 installed in node_modules while f8c8da2's package.json pins zod ^3.25.76 — building in place fails tsc (lib/contracts/config.ts TS2769); I built from a clean `npm ci`. Full web re-gate waits for Wren's report.
