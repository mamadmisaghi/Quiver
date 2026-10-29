# Gate: backend 485da53 (M4.9.1). Verdict: PASS, deployed

All times are Asia/Tehran, 2026-10-28. I worked in a fresh copy at /tmp/robin-g485be (git archive of 485da53).

## Standard checks
| Check | Result |
|---|---|
| vitest | 373/373 |
| tsc, lint, fixtures:check | all return 0 |
| npm audit | 0 vulnerabilities |
| forge | 54/54 |

## My own probes
Probe file: qa/poc/robin-g485-m491.test.ts, 8/8 pass.

| Fix | Result |
|---|---|
| B1 cost reservation | Estimate = cost 0.4, cap $1: 12 concurrent calls made 2 AI calls and spent $0.80. PASS |
| B2 instruct counts toward the compile quota | Quota 3: compile 200, instruct 201, invalid instruct 422. The 4th call got 429 `compile_quota_exceeded`, Retry-After 32400, `compilesUsedToday` 3. PASS |
| Invalid instruct stores nothing | 422 `strategy_invalid` with `/triggers` `strategy_needs_rule`. 0 rows changed and the strategy version is the same. PASS |
| 422 shapes | missing_field, invalid_value, `/strategy/triggers` strategy_needs_rule, out_of_range, too_short, unknown_field. PASS |
| B3 HMAC alias | @trader_697b76ce, not the plain sha256 (@trader_9bc68c5c), and stable. PASS (checked locally) |
| Card Cache-Control | `public, max-age=5`, locally and on the VPS. PASS |
| stop_and_flatten 5 s cap | Returned 200 in 5004 ms, flatten_timeout event emitted, run stopped. PASS |
| Kill 207 | One stop failed: 207 `{stopped:1, failed:[{runId, reason}]}`. The other run stopped; a retry returned 200. PASS |
| stepAll in parallel | With one stuck user: 302 ms, the other 20 done, at most 8 in flight, timeout logged. PASS |

## stop-api.cmd on the real VPS (during the deploy)
- Token passed as a file (argument 3).
- No second copy of the token: C:\quiver\secrets\ops_token does not exist.
- Token not found in the process list (wmic) or in the logs (`findstr /g`).
- The temp curl config existed only during the stop: none before, gone after.
- Shutdown was accepted with activeRuns 0. STOP_T0 12:07:48.54, STOP_T1 12:07:49.82. The wait loop polled until the port closed, then printed "API stopped cleanly", RC 0.

## Findings (all Low or Medium)
1. **Medium/Low.** On a cold day (default estimate 0.05, real cost 0.4), 12 concurrent calls spent $4.80 against a $1 cap. The overshoot is up to about N × (actual − estimate) until maxCall learns the real cost. Recommendation: set LLM_EST_CALL_USD to a realistic value.
2. **Low.** An invalid instruct that returns 422 still uses up one compile from the quota.
3. **Low.** When stop_and_flatten hits its cap, a late flatten fill still runs after the stop and its events are dropped. Paper positions change without any event.
4. **Note.** On the VPS, dev-login users show their label as the handle, so the HMAC alias could only be checked locally.
