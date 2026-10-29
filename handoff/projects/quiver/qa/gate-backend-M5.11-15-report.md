# Backend gate: M5.11–M5.19. Final tip 86f3fa5. Verdict: PASS (deployed)

Gate by Robin, 2026-10-28 (Tehran time, UTC+3:30). Scope grew by steering: 6d3a108 (M5.11–15), then 74b5a26 (M5.16), 1ef101b (deps + M5.17 search + SIGNOFF §9), bd0ec27 (M5.18 Tiingo), and finally 86f3fa5 (M5.19). 6d3a108 was deployed at 14:34. 86f3fa5 replaced it at 15:55.

The gate ran in a clean worktree. `/workspace/quiver/backend` holds another agent's uncommitted WIP, which I did not touch.

## Checks (86f3fa5)
- `checks.sh` RC=0, "ALL CHECKS PASSED". It runs tsc, lint, fixtures gen/check/diff, vitest **490/490 (66 files)** and forge **54/54**, which matches Sage's numbers. Log: /tmp/checks86.log.
- `checks.sh` really does exit 1 on failure. On the dirty shared tree (WIP lint error plus 2 failing tests) it returned RC=1, and on a worktree with lint deps missing it also returned RC=1. Clean runs return RC=0.
- `npm audit`: 0. ws@8.22.0 and viem@2.57.13 are in place (721060a). The wallet-link and chain probes (M5.15/16) still pass.
- My probes in qa/poc/: robin-m515, m516, m517, m518 and m519. That is 48 + 3 tests, all passing at 86f3fa5.
- Fixtures: no diff bd0ec27..86f3fa5, and FIXTURES_GEN_CHECK passes.

## M5.17 /v1/search
- Public data only. Private strategy names and ids never match. Unpublishing removes a strategy from results.
- No usr_, did:, dev: or run_ ids in responses.
- Patterns like `.* % * (a+)+$ [ \`, SQL/NoSQL strings, `<script>`, NUL and emoji are treated as plain substrings: 200 or 422, never a wildcard.
- Length: 80 characters OK, 81 returns 422, whitespace-only returns 422.
- `limit` values 0, 21, -1, 1e9 and abc return 422. A duplicate q is not a 500.
- Rate limit: the 61st call in a minute returns 429.

## M5.18 Tiingo (mocks only; real Tiingo never called)
- With an empty key, no fetch call is made, and history and backtest use `dataSource: "fallback"`.
- The key is sent only as `Authorization: Token`, and the host is api.tiingo.com. A thrown error that echoed the key was logged as `[redacted]`. The key never appears in responses.
- Fetch settings: 8000 ms timeout (a hung body is aborted), 4 MB streaming cap that works without content-length, `redirect: "error"`, LRU cache (eviction checked with size 2), 45 calls/hour (then rate-limited, recovers after an hour).
- If any instrument fails, the whole backtest falls back, and `dataSource` is accurate.
- Malformed symbols make no call. `BRK.B` and `A..` stay under /tiingo/daily/.
- External-wallet copy (POST /copy with address/wallet/externalWallet, and /copy/wallet/*) returns 501 not_available. Strategy and run counts are unchanged.

## M5.19 daily stock/ETF next-open fills (own probe robin-m519 plus code review)
- **No look-ahead:** decisions use the bar's close (T−1 ms). `openAt` only reads a bar that has finished by `now`. In the fixture, a Thursday close of 160 is followed by a Monday open of **50** (Good Friday falls between). The fill was at about 50.05 at 2026-04-06 13:30Z, which is the next open, not the close.
- **Holidays:** Good Friday 2026-04-03 is skipped (my probe), and so is Thanksgiving 2026-11-26 (Sage's test, which fills Fri 14:30Z EST). Weekend decisions are refused, and a Friday decision fills on Monday.
- **Slippage direction:** the buy filled at 50.05, above the open of 50. The sell filled at 399.31, below the open of 400.
- **End of range:** a queued order is not filled, and a caveat is added.
- **Crypto and intraday unchanged:** results from bd0ec27 and 86f3fa5 are byte-identical for crypto 1d, crypto 1h and stock 1h. Those runs had no trades, so this is weak evidence; the strong evidence is that fixtures are unchanged. The code path is gated on `resolution==="1d"`, robinhood venue and equity/ETF.
- The M5.18 Info "daily stock backtests never fill" is **resolved**.

## SIGNOFF.md §9 vs config (fcc82c3/1ef101b)
- Every documented key exists.
- Undocumented: AA_PROVIDER, CHAIN_ID, LLM_PROVIDER, NODE_ENV, RPC_URL, VERIFIED_READONLY_PATH (Info).
- In .env.example but not in the doc table: ALERTS_EMAIL_API_KEY, PRIVY_JWKS_URL, PRIVY_VERIFICATION_KEY, TESTNET_SESSION_ACCOUNT_CODEHASH (Info).

## Findings (owner Sage unless noted)
| Sev | Finding |
|---|---|
| Medium (carried) | drawFrames can allocate about 311 MB. This only affects the ffmpeg renderer; the VPS uses the stub. |
| Low | `FFMPEG_PATH` is not checked to be an absolute path, and its default is the Linux `/usr/bin/ffmpeg`. It spawns with shell:false and env:{}. The stub stays on the VPS. |
| Low | The Tiingo 45/hour budget is global, so any user can drain it through history calls. It falls back safely. |
| Low (carried) | Earlier M5.11–15 Lows stand. |
| Info | Handles can be enumerated through /search. Public strategy id = stg id. /search echoes q. The SIGNOFF doc gaps above. `/copy/wallet/%2e%2e` is normalized to a 404, not a 501. |
| Info | VPS api-start.bat already contains `set TIINGO_API_KEY=` (empty) and `set OPENROUTER_API_KEY=` (empty), last modified 14:34 Tehran. My guard first refused it; I checked that both values have length 0 and kept them empty. |
| Info | Leftover partial dir `releases\4c5845b-bd0ec27\backend` from the superseded build. It is unused. |
