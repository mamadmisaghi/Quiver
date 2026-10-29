# Sage fixes for QA gate 2c52ff0 (M3.5)

- **Backend commit:** `19e4ba1` ("M3.5: …") in `/workspace/quiver/backend`.
- **Checks:**
  - forge: 29/29 (22 SessionAccount, 7 Robin PoC regressions).
  - vitest: 174/174 (includes anvil e2e on SessionAccount v2).
  - tsc: root and contracts both clean.
  - fixtures: ok.
  - `npm run lint`: clean.
- **SessionAccount remains UNAUDITED.** `AUDIT_STATUS = "UNAUDITED"` is on-chain. No mainnet deploy was done.

| # | Finding | Fix | Regression test (now fails to exploit) |
|---|---|---|---|
| P1-1 | Backtests accept future `to` and pre-data ranges (btFuture, btEpoch) | `to > now` → 422 `backtest_range_invalid` `{reason:"future", latestTo}`. `from` < UTC midnight of now−365d → `{reason:"before_data", earliestFrom}` (`BACKTEST_HISTORY_MS`). | `m35.test.ts`: btFuture, btEpoch, valid range still 202 |
| P1-2 | No per-user cap on active runs or SSE connections | `MAX_ACTIVE_RUNS_PER_USER` (5) and `MAX_SSE_PER_USER` (10), set by env and documented in `.env.example` and api-contracts §19. Over the cap → 429 `limit_exceeded`. The SSE slot is released on abort or close. | `m35.test.ts`: run cap, SSE cap (including slot freed after close), defaults |
| P1-3 | Dev login on by default (devLoginImpersonate) | `DEV_LOGIN_ENABLED` defaults to false. Config refuses it when `NODE_ENV=production` (already refused on mainnet). Boot prints a warning when it is on. `.env.example` and §19 state that a preview must sit behind HTTP basic auth. | `m35.test.ts`: dev login off by default (401), production refused |
| P1-4 | SessionAccount: any tokenIn, cap unit confusion, minOut 0 accepted | Token allowlist with per-token `perTxCap` and `windowCap` in token units. `minOut == 0` → `MinOutZero`. `minOut` < oracle floor (Chainlink USD feeds, `maxSlippageBps` ≤ 1000) → `MinOutBelowFloor`. A missing or stale oracle fails closed. | `RobinPoCRegression.t.sol`: capUnitConfusion, minOutZero/floor; `SessionAccount.t.sol`; anvil e2e minOut=0 rejection |
| P2-c1 | Calendar-day window allows a midnight double spend | Rolling 24h spend log (max 64 entries). A re-grant keeps the log, so the window cannot be reset. | midnightDoubleSpend |
| P2-c2 | Global nonce / replay | Per-key `nonces[key]`. The digest binds chainid, account, key, target, keccak(data), nonce and deadline. | perKeyNonce, replayBlocked |
| P2-c3 | Hand-rolled ecrecover (malleable) | Vendored OZ v5.4.0 `ECDSA.tryRecover` (MIT). | malleableSigRejected |
| P2-c4 | No deadline | `deadline` is in the digest; expired → `SigExpired`. | SessionAccount.t.sol |
| P2-c5 | `grant` accepts past expiry | `BadGrant` on a past expiry, bps > 1000, empty or mismatched arrays, a zero cap, perTx > window, or duplicate tokens. | guards |
| P2-c6 | Loose calldata decoding | Strict per-selector decoder: `allow(target, sel, Kind)` requires the selector to match the Kind; calldata length must be exactly 4+160; recipient must be self. | guards, SessionAccount.t.sol |
| P2-a1 | Equity 0, negative, or 1e30 accepted | `EquityUsd` accepts decimals from 100 to 10,000,000 only. | `m35.test.ts`: btZeroEquity/Neg/Huge |
| P2-a2 | Raw internal error text leaked | Non-`BacktestError` failures return a generic message; the detail is logged server-side. | `m35.test.ts`: injected ECONNREFUSED text not returned |
| P2-a3 | Stream tickets reusable | `jti` with single use; reuse → 401 "Stream ticket already used" on both stream routes. | `m35.test.ts`: sseTicketReuse |
| P2-a4 | `versions/abc` returned the latest version | Only `^[1-9]\d{0,8}$` is accepted, otherwise 404. | `m35.test.ts`: versionNaN (abc, 0, 99, 1.5, -1) |
| P2-a5 | Unknown routes returned 401 | 404 before auth, built from the route table. | `m35.test.ts`: notFound; m34 auth sweep still 401 |
| P2-a6 | No security headers | nosniff, DENY, no-referrer, CSP `default-src 'none'; frame-ancestors 'none'`, CORP same-site. | `m35.test.ts`: secHeaders |
| P2-a7 | Unbounded rate-limit map | Hard cap of 50k buckets, with expired buckets pruned every 60s and on overflow. | `m35.test.ts`: bounded rate-limit map |
| P2-a8 | Refresh cookie not Secure | Secure, except mock mode on localhost. | `m35.test.ts`: refresh cookie |
| P2-a9 | zod < 4.6.6 | zod ^4.6.7 in backend and contracts. `zod-to-json-schema` was replaced by `z.toJSONSchema`. | full vitest suite |
| P2-a10 | No working eslint | ESLint 10 + typescript-eslint flat config in the isolated `tools/lint` package (typescript-eslint needs the TS 5.x JS API; the backend uses TS 7 native). Run `npm run lint:install` once, then `npm run lint`. Fixed 12 findings. | `npm run lint` clean |

## Notes and items not verified

- **Robin's PoC file.** Robin's original `qa/poc/RobinPoC.t.sol` targets the v1 ABI and no longer compiles against v2. Its seven attacks were ported to `foundry/test/RobinPoCRegression.t.sol`, where each one now reverts. I did not edit Robin's file.
- **Data window assumption.** The "data begins" bound is the v1 history window (now−365d). It does not come from per-instrument data inventory.
- **Oracle floor.** The floor depends on Chainlink feed addresses set via `setFeed`. No feed addresses have been verified for any chain; unverified feeds stay unset and swaps fail closed with `OracleMissing`.
