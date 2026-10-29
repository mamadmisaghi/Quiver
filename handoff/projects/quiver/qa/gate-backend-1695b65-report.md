# Gate: backend 1695b65 (Sage M3.6), Robin, 2026-10-27, Asia/Tehran (UTC+3:30)

**Verdict: PASS.** The 8 P2 findings from gate 19e4ba1 are all fixed, and I verified each one with my own probes. Method: same as gate-backend-19e4ba1, run in a fresh /tmp worktree (/tmp/robin-g8be) at the detached commit 1695b65, killing only my own PIDs.

## 1. Build and tests
| Check | Result |
|---|---|
| forge | 54/54 across 4 suites (6, 7, 22, 19) |
| vitest | 185/185 across 23 files |
| tsc (root and contracts) | 0 errors |
| lint | clean |
| npm audit | 0 vulnerabilities |

## 2. P2 fixes, each checked with my own probes
1. **NODE_ENV casing.** These values are refused: production, Production, PRODUCTION, " production\t" and "pRoDuCtIoN\n". Mainnet mode and CHAIN_ID 4663 are refused too. development, prod and testnet are accepted. Dev login is allowed only in mock or testnet mode. Setting it to "1" or "TRUE" gives a config error. **PASS.**
2. **setFeed bounds and round completeness.** maxAge values of 0, 59, 24h+1 and uint32.max get BadFeed. 60 and 24h are accepted. feed=0 with maxAge>0 gets BadFeed. A non-owner caller gets NotOwner. A price older than 24h always fails closed. answeredInRound < roundId gives OracleStale (M36.t.sol). Extra: a sequencer startedAt in the future underflows and fails closed. Down and grace (M36) are covered. **PASS.**
3. **Slippage cap.** The default is 100. A grant at 101 gets BadGrant. setSlippageCap rejects 0 and 1001, and a non-owner gets NotOwner. After a raise to 1000, a grant at 1000 is OK and one at 1001 gets BadGrant. **PASS.** P3 note: lowering the cap later does not shrink existing grants. The owner has to re-grant or revoke them.
4. **Minimum swap of ceil(windowCap/64).** With a non-divisible windowCap of 2500e6+7, minSpend−1 gets BelowMinSpend. Swaps of exactly minSpend are filled until the cap, and the next one gets **OverWindowCap, never TooManySpends**, so the log cannot fill before the cap is reached. A grant with windowCap > 64×perTxCap gets BadGrant. **PASS.** P3 note: if a re-grant raises windowCap, old small entries can briefly make the log fill early. This is owner-induced and self-only, and lasts at most 24h.
5. **Rate-limit map full means 429, not eviction.** I sent 50,000 distinct X-Forwarded-For keys to /v1/auth/refresh within one window. The 50,000th key got 429 rate_limited, and a brand-new IP got 429 too. Victim IP A had already used its 30 requests: its counter was **kept** (still 429) and not evicted. **PASS.** P3 note: anyone who controls about 50k source IPs can block *new* clients for up to 60s. That's an accepted trade-off, since Caddy sets XFF from the real remote address.
6. **CORS credentials.** The allowed origin gets ACAO plus ACAC true, including on preflight. Evil, missing, null and prefix-trick (…:46300) origins get no ACAO and no ACAC. **PASS.**
7. **Stop is the last event.** In 6 runs stopped at 0–16.5s, stop returned 200 in 3–16ms. `stopped` was the last event every time, with 0 events after it at +20s. A second stop returns 409. **PASS.**
8. **Backtest skew clamp.** `to` at +4m58s or +4m59s gives 202, and −2m gives 202. +5m01s and +1h give 422 future. Ranges that become empty after the clamp give 422 validation_failed, which is acceptable. 1970 gives 422 before_data. **PASS.**

## 3. RobinV2 copy (foundry/test/RobinV2.t.sol)
- The diff against qa/poc/RobinV2.t.sol (md5 6cda357e…) has only 3 changes: a header comment, `acct.setSlippageCap(1_000)` in setUp, and 2 reversed tests. The comment mentions "three" P2 FINDING tests, but only 2 were reversed. test_new_maxSlippageTenPercentAccepted stays as the design note, which is fine.
  - **ownerCanDisableStaleness** now asserts BadFeed for uint32.max, 24h+1 and 59, and that 60 and 24h are accepted. This is a legitimate reversal: the attack is now impossible, not just weakened.
  - **spendLogDoS** now asserts that the original 300-bps grant with windowCap of 100k > 64×1k gets BadGrant, that dust gets BelowMinSpend(ceil(w/64)), and that minSpend goes through. This is legitimate. It doesn't show that the log reaches the cap before filling, so I added that probe myself (item 4).
- **Original PoC against the new contract:** setUp fails with BadGrant, because its grant uses 300 bps over the 100 default. That is the intended behaviour change. With only the one-line opt-in added, 17/19 pass. The 2 failures are exactly the fixed findings: ownerCanDisableStaleness gets BadFeed and spendLogDoS gets BadGrant. Nothing else changed.
- My probes are in qa/poc/RobinM36Probe.t.sol (6/6 PASS).

## 4. Diff 19e4ba1..1695b65
14 files, +403/−30, all in scope: config.ts, contracts tsconfig, SessionAccount.sol, app.ts (skew, RL, CORS), manager.ts and executor.ts (abort), plus new tests. There are no new dependencies, no network or key code, and nothing unexpected.

## 5. Local integration with web c8bb32b
Over a plain-HTTP proxy, the run had sign-in, markets with live prices, a reload with no refresh loop, and a **backtest that succeeded on the first try with no ≥400 responses**. It also had a paper run with streaming and a stop: Stopped held at +32s, and the activity log did not change after the stop.

Screenshots are in shots/robin/local-1695b65/. My own PIDs were 1226044, its child 1226072, 1226045 and 1226047, and all were killed.

## Owners of the P3 notes (none block the gate)
- Sage: lowering the cap does not apply to existing grants; the windowCap re-grant edge case; the stale "three" comment.
- Ops: RL lockout trade-off.
