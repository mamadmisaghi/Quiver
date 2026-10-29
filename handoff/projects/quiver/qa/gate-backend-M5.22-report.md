# Gate: backend M5.22 + M5.23 (Robin): **PASS, deployed** (final tip e6303b3)
Date: 2026-10-28, Tehran time. The scope was extended mid-gate from 0c96c48 to e6303b3. Both were gated and deployed in turn.

## Re-run (worktree, clean checkout)
- e6303b3: typecheck 0. Vitest 72 files, **520/520**, including the m523-testpool anvil e2e (it ran, not skipped). Lint 0. fixtures:check 0. Forge 59/59, plus my 3 scratch tests = 62.
- 0c96c48: typecheck 0, vitest 511/511, lint 0, fixtures 0, forge 59/59.
- Sage's `checks.sh` isn't in the repo. I ran the equivalent commands (Info).

## M5.22 ledger (04f7e71)
- Off by default: `REVENUE_ACCOUNTING_ENABLED` defaults to false, and live shows `accounting:"off"`.
- When on, it's pure computation: no signer, wallet, RPC or transfer code in the diff. `claimableUsd` is always "0.00" and `claimEnabled` is false.
- BPS: -1, 1.5, abc, 5001 and 10000 are rejected; 0, 1 and 5000 are accepted. The cap is 5000, tighter than the brief's 10000 (Info).
- Integer cents with a floor: 21¢ × 3333 bps gives 6¢.
- Isolation: B sees only B's rows. No auth gives 401. There's no POST/PUT/PATCH/DELETE or claim route.
- Public leaderboard, landing, health and status don't leak ledger fields.

## M5.22 forge script (0c96c48)
- Closed allowlist (46630 and 31337).
- Scratch forge tests: 14 mainnet and L2 ids are refused (1, 4663, 8453, 10, 42161, 137, 56, …), 256 fuzz runs are refused, and `run()` on 8453 is refused.
- Local anvil only: 31337 simulates, 4663 and 8453 revert. Nothing was broadcast and no key was used.
- The only env read is `vm.envOr(TEST_POOL_SEED_NVDA)`. No PRIVATE_KEY or mnemonic.
- Not wired into any deploy.
- The broadcast artifacts committed in 0c96c48 are removed in e6303b3, and `foundry/broadcast/` is gitignored, which resolves that finding.

## M5.23
- **Deposit prepare:**
  - `chainId` other than 46630 (numeric, string, hex, null) gets 422.
  - Extra body keys (to, data, value, recipient, tx) get 422 (strict).
  - `?chainId=1` in the query is ignored; the tx is still 46630.
  - `to` is the caller's own session smart account, or tUSDG `transfer(ownSA, units)`.
  - Another user's wallet gets 409, and a user with no smart account gets 409; it never falls back to someone else's.
  - Rate limit is 20/min per user, and the bucket isn't shared between users.
  - Unsigned, with no key in the path.
- **Test pool:**
  - Off by default.
  - Quotes are eth_call only, through a public client with no wallet.
  - An RPC on the wrong chain gives 503.
  - Approve is for the **exact amount** (not unlimited) and is skipped when the allowance is enough.
  - `minOut = out × (1 − slippage)`, with slippage 1..500 bps and a deadline of 60..1800 s.
  - The swap goes to the pool, and its recipient is the caller.
  - Injected to, minOut or recipient gets 422.
- **`/testpool/status` (public):** only the 7 expected keys, addresses and missing **names**. An RPC URL with credentials in it isn't echoed.
- **SIGNOFF §9.1** correctly says a human runs the broadcast with their own Ledger or keystore and Honey's approval.

## Health / web compatibility
- The live web 726e6a2 never calls `/health`.
- Its own zod contracts parse the new MarketHistory, Backtest and Revenue responses and strip the new keys.
- History `notice` stays a string, and the web's `isWarmupNotice` still matches it.
- Result: safe, so I deployed.

## Findings
| # | Sev | Owner | Finding |
|---|---|---|---|
| 1 | Medium (doc) | Sage | SIGNOFF env table (line 108, `DEPLOYER_ADDRESS`) says "Gofi (wallet) / **Robin (runs it)**". That contradicts §9.1 ("A human runs these steps") and the rule that agents never broadcast. Change it to "a human operator". Not blocking, since no code path broadcasts. |
| 2 | Low | Sage | The deposit cap compares with `Number(amount)`: `"1.000000000000000001"` ETH passes the 1 ETH cap and prepares 1e18+1 wei. Testnet only, unsigned, and to the user's own account. Fix: compare `parseUnits` against the cap in base units. |
| 3 | Low | Sage | `/revenue` ledger does O(strategies × runs × events) work per request. Fine at paper scale. |
| 4 | Low | Sage | The test pool caches the RPC chain-id check as true for the process lifetime. The tx chainId is hard-coded to 46630 anyway. |
| 5 | Info | Sage | Ledger `Number()` on a malformed fill would give NaN (theoretical). There's no forge test for 8453 in the repo (the allowlist covers it; I proved it with a scratch test). checks.sh is missing. HealthRes is `.strict()` (server-side only). |

## Deploy (VPS)
- 19:41: 0c96c48 into `releases\0c96c48-726e6a2\backend` (tarball sha256 c356212b…fe26, certutil matched).
  - `api-start.bat` was backed up to `api-start.726e6a2-297d8dd.bat` (fc OK).
  - Graceful stop with activeRuns 0, then `/end`, `/run`. Ready at 19:41:33.
- 19:49: e6303b3 into `releases\e6303b3-726e6a2\backend` (sha256 30ef5215…1b35, certutil matched).
  - Backed up `api-start.726e6a2-0c96c48.bat`. Only the cd line changed.
  - Guards: SIWE, stub, mock, TIINGO and OPENROUTER empty, and no REVENUE_, CREATOR_, TEST_POOL_, SECRETS_MASTER_KEY or Telegram/X vars.
  - Stop with 0 runs (clean), `/end`, `/run` at 19:49:22. Ready at 19:49:42. Still ready at 19:50+. **API PID 21544.** PumPals 12968 and web 11508 untouched.
- Outside checks via :8091:
  - health, `/` and `/app` return 200.
  - `/testpool/status` shows enabled:false with names only.
  - revenue `accounting:"off"`.
  - Quote gives 503, deposit with chain 1 gives 422, an unlinked wallet gives 409.
  - :8987 isn't reachable from outside.
- 120× `/u/@…` returned 404 (120/120), and pumpals.fun returned 200 ×5.
- Nothing was broadcast. TEST_POOL_ENABLED and REVENUE_ACCOUNTING_ENABLED are unset.

## Rollback
With 0 runs:
1. `releases\e6303b3-726e6a2\backend\scripts\ops\stop-api.cmd 8987 QuiverApi C:\sites\quiver\env\ops.token`
2. Restore a bat:
   - Back to 0c96c48: `copy /y C:\sites\quiver\api-start.726e6a2-0c96c48.bat C:\sites\quiver\api-start.bat`
   - Back to 297d8dd: `copy /y C:\sites\quiver\api-start.726e6a2-297d8dd.bat C:\sites\quiver\api-start.bat`
3. `schtasks /end /tn QuiverApi`, then `schtasks /run /tn QuiverApi`.

All release folders are intact.
