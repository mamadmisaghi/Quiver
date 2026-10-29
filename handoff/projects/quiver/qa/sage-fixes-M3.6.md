# Sage — M3.6 fixes for Robin's gate on 19e4ba1 (all P2)
Date 2026-10-27 (Asia/Tehran). Repo /workspace/quiver/backend. SessionAccount stays UNAUDITED / local-only. No deploys, no mainnet, no funds.

| # | Finding | Fix | Test |
|---|---|---|---|
| 1 | Backtest `to` slightly ahead of server clock → 422 | `to` ≤ now+5 min is clamped to now; > 5 min still 422 `future`. Range checks run on the clamped value. Documented in api-contracts.md §20 | test/integration/m36.test.ts (+4m59s, +5m → 202; +5m01s → 422) |
| 2 | "Checked signals" tick ~3 s after "Stopped" | stop aborts the in-flight tick (AbortController; executor bails at await boundaries; emit drops everything from an aborted tick); stop no longer awaits the tick; `stopped` is always the last event. stop_and_flatten waits for the aborted tick, flattens, then `stopped` | test/unit/m36-stop.test.ts (slow 300 ms tick; fails on 19e4ba1, passes now) |
| 3 | `NODE_ENV=Production` bypass (contracts/src/config.ts:83) | trim+lowercase compare; dev login also only allowed when QUIVR_MODE is mock or testnet | m36.test.ts (production/Production/PRODUCTION/" production ", mainnet refused; mock/testnet ok) |
| 4 | setFeed maxAge unbounded; round completeness; sequencer | maxAge 60 s–24 h (`BadFeed`), `setFeed(t,0,0)` clears; `answeredInRound >= roundId` and `updatedAt != 0`; optional `setSequencerFeed(feed, grace)` → `SequencerDown` while down / in grace | foundry/test/M36.t.sol, RobinV2 `test_new_ownerCanDisableStaleness` inverted |
| 5 | maxSlippageBps up to 10% | `slippageCapBps` default 100; grant rejects above it; owner `setSlippageCap` (1–1000) is the explicit raise. App strategies default 50 bps. Documented (api-contracts §20, ARCHITECTURE T15, SIGNOFF §7) | M36.t.sol `test_slippageCapDefault100UnlessOwnerRaises` |
| 6 | 64-entry spend-log dust DoS | min notional per swap `ceil(windowCap/64)` (`BelowMinSpend`) + grant requires `windowCap ≤ 64×perTxCap`, so the log always hits the cap before it fills. Documented ARCHITECTURE T14 | M36.t.sol `test_minNotionalPerSwap`, RobinV2 `test_new_spendLogDoS` inverted |
| 7 | RL map overflow evicted old counters | full map (after pruning expired) → 429 for new keys; no eviction | m36.test.ts (rlMax=3 test hook) |
| 8 | ACAC sent without allowed Origin | credentials header only for allowlisted Origin (incl. preflight) | m36.test.ts |

## RobinV2.t.sol
Compiles against the repo. Copied to foundry/test/RobinV2.t.sol with: setUp calls `setSlippageCap(1_000)` (Robin's grants use 300/1000 bps — now an explicit owner opt-in), and the three FINDING tests (disable staleness, spend-log DoS; ten-percent stays valid only after the explicit raise) turned into regressions. Original in qa/poc untouched.

## Results
forge 54/54 (4 suites) · vitest 185/185 (23 files, incl. anvil e2e) · lint clean · typecheck clean (also fixed pre-existing TS7 `node:fs` error in contracts/tsconfig via `types: ["node"]`).

## Notes / residual
- An aborted paper tick may already have applied a fill inside the venue call that was in flight; its event is dropped. Paper only; live would need the signer to check the abort flag before send (do when live execution lands).
- Minimum swap with SIGNOFF defaults ($250/tx, $1000/day) = $15.63; tell users in the session-key UI.
- Sequencer feed address for 4663 not verified (V7); default off.

## Web (Wren)
- Send backtest `to = now − 2 min` (server tolerates +5 min, clamps). Handle 422 `reason: future` by showing `latestTo`.
- Treat `status: stopped` as terminal; the backend guarantees nothing follows it (the client can drop any late frames defensively).
- Handle 429 `rate_limited` on login/refresh with `retryAfter`.
- Session-key UI (when built): slippage max 1% unless the owner raised the cap; show the per-swap minimum `windowCap/64`.
