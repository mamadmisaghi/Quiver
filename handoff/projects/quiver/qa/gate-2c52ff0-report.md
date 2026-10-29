# Robin QA gate — Quiver web @ 2c52ff0 + backend (M3.3 → re-verified at a1b0510)
Date: 2026-10-27 (Asia/Tehran). Verdict: **FAIL** (1 P0, 6 P1).

## 1. Typecheck / lint / tests
| Check | Result |
|---|---|
| Backend tests (vitest) | M3.3: 17 files 131/131 · HEAD a1b0510: **20 files 159/159 pass** |
| Backend tsc | M3.3 FAIL (contracts/fixtures/check.ts TS2591 node:fs) · **HEAD: 0 errors** (fixed) |
| Web tsc @2c52ff0 | 0 errors |
| Lint | **No lint script / eslint in either package** (P2) |
| Web builds (live + mock) | both succeed (logs /tmp/robin-build-*.log) |
| npm audit | 1 high in both: zod <4.6.6 (GHSA-mrhx-c7xc-m3w5) — still present at HEAD |
| Foundry | **20/20 pass** (13 existing + 7 Robin PoC, qa/poc/RobinPoC.t.sol) |
| Slither 0.8.26 | 7 low/info (missing zero-check ctor/ownerCall, timestamp, low-level calls, unindexed event addrs); 0 high/med |

## 2. UI sweep (Playwright, DPR 2, 1440/768/390, 12 pages, mock + live + live-no-login)
- 72 mock/live shots + 36 live-no-login shots in shots/robin/. JSON: qa/sweep-2c52ff0.json, sweep-live.json, sweep-live-nologin.json.
- Horizontal overflow: 0. Unnamed buttons / unlabeled inputs / img w/o alt: 0. Exactly one h1 per page.
- 11px text: 5 nodes on every app page (bottom nav labels) — below 12px floor.
- Lighthouse mobile (qa/lh/*.json):

| Page | mock perf/a11y · LCP · CLS | live perf/a11y · LCP · CLS |
|---|---|---|
| / | 96/100 · **2.7s** · 0 | 96/100 · **2.7s** · 0 |
| /app | 99/100 · 2.1s · 0 | 99/100 · 2.1s · 0 |
| /app/new | 99/100 · 2.1s · 0.001 | 95/100 · **2.8s** · 0.008 |
| /app/markets | 97/95 · 2.6s · 0 | 98/95 · 2.1s · 0 |
LCP element on / is the hero `<p data-motion="rise" style="--d:160ms">` (animation delay counts against LCP). Markets a11y: tablist missing role=tab children; large table td without headers.

## 3. Functional flows (qa/poc/flows.mjs, output flows-a1b0510.json)
Pass: compile NDJSON stream 15.0s; 422 for short/huge/bad JSON; prompt-injection → unsupported_prompt. IDOR 404. Backtest deterministic (30d/1h 224ms, 365d/15m 1.3s, 60d/1m 3.2s), 366d/reversed/sub-bar rejected, max 3 concurrent then 429. Paper run 201, dup 409, live 403. SSE 200 text/event-stream, Last-Event-ID resume, 3 tabs same ids, bad ticket 401, stop 200 / again 409. CORS evil origin rejected, forged/none JWT 401, 20MB body now 422, guest compile XFF spoof now 429 (fixed at HEAD, TRUST_PROXY=false).

## 4. Findings (ranked)
### P0
1. **[Wren] Live /app/markets crashes vs current backend.** 2c52ff0 `PriceSource` enum lacks `jupiter_readonly` → zod pageerror, table stuck on "Loading markets…". File lib/contracts/common.ts:40, lib/api/format.ts:39. Fix: already in web 994f663 — re-gate that SHA. Evidence: sweep-live.json pageerror, shots/robin/live-nologin/live-1440-app_markets.png.
### P1
2. **[Wren] Unknown run id silently starts a demo run.** lib/api/live.ts:125-127: 404 → creates+starts a demo paper run; URL ≠ shown run, GET causes writes, page never idles. Fix: "Run not found" state; demo only for id `demo`. Evidence: shots/robin/live-390-app_run_run_01HZXK8P2Q4M.png.
3. **[Wren] Live without session is a dead end.** Home "Sign in to load your data." with no CTA; Markets unhandled rejection + infinite loader. Fix: sign-in CTA/empty-error state; catch in components MarketsTable.tsx. Evidence: live-nologin/live-390-app.png.
4. **[Sage] Backtests accept future and 1970 ranges** and return synthetic results (btFuture, btEpoch done). Fix: reject `to > now` and ranges before coverage start (src/api/app.ts backtest route).
5. **[Sage] No per-user cap on concurrent paper runs / strategies** (1 per strategy only) and **no per-user SSE connection cap**. Fix: e.g. ≤5 active runs, ≤10 SSE per user.
6. **[Sage] Dev login = impersonation.** DEV_LOGIN_ENABLED defaults true (contracts/src/config.ts:66); anyone knowing a label is that user (devLoginImpersonate=1). Fix: preview must sit behind Caddy basic auth; default false outside local.
7. **[Sage] SessionAccount caps are raw token units with no tokenIn allowlist.** PoC test_PoC_capUnitConfusion: caps set in 18-dec units let a session key swap the entire 6-dec USDG balance in one tx. Also session key chooses minOut (PoC minOutZero) → sandwich extraction up to cap. Fix: per-session tokenIn allowlist + caps per token (or oracle USD), enforce minOut ≥ oracle·(1−maxSlippage). File foundry/src/SessionAccount.sol.
### P2
8. [Sage] SessionAccount "rolling daily" cap is a UTC-day bucket → ~2× cap in 2 min across midnight (PoC midnightDoubleSpend). Fix: true rolling window or document.
9. [Sage] Global nonce shared by all keys → one key's tx invalidates others' pre-signed ops (PoC globalNonceCrossKeyGrief). Fix: nonces[key].
10. [Sage] Raw ecrecover, malleable sig accepted (PoC malleableSigAccepted; replay still blocked). Fix: OZ ECDSA (low-s). Add signature deadline to digest; reject grant with past expiry; abi.decode assumes swap layout for every allowlisted selector — bind layout per selector.
11. [Sage] startingEquityUsd ≤0 and 1e24 accepted; raw backtest error text returned (app.ts ~253); stream tickets reusable within 60s (should be single-use); /strategies/:id/versions/abc returns latest; unknown routes 401 not 404; no security headers (nosniff, frame-ancestors, referrer-policy); `rl` map unbounded; refresh cookie not Secure in mock (matters on HTTPS VPS).
12. [Sage] zod high advisory — bump to ≥4.6.6 (both packages; Wren for web).
13. [Wren] 11px nav labels (12px floor); hero LCP 2.7–2.8s on mobile (drop rise delay on LCP element); markets tablist/table a11y.
14. [Wren+Sage] No lint config in either package.

## 5. Contract audit summary
60-line SessionAccount.sol read in full. Good: EIP-191 digest binds chainid + address(this) + nonce; CEI (nonce/spend before call); recipient==self check; approve/transfer denied unless allowlisted; owner-only admin. Issues: items 7–10. No selfdestruct/upgrade; owner immutable (no key rotation/recovery — note). All PoCs run locally only (forge, in-EVM throwaway keys).

## 6. Best screenshots
1. shots/robin/live-nologin/live-1440-app_markets.png — P0/P1 stuck loader
2. shots/robin/live-nologin/live-390-app.png — dead-end sign-in
3. shots/robin/live-390-app_run_run_01HZXK8P2Q4M.png — wrong run shown
4. shots/robin/mock-1440-home.png — visual bar reference (passes)

Deploy plan: qa/vps-deploy-plan.md (prepared, not executed).
