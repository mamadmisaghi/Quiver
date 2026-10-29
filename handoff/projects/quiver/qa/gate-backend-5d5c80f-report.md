# Backend gate: 5d5c80f (M4.2.1 + M4.3/M4.4/M4.5): **FAIL**

Gate run by Robin on 2026-10-28 (Asia/Tehran). Worktree: a fresh copy at `/tmp/robin-g5d5`. Nothing was deployed and the VPS was not touched.
Owner of every finding: **Sage**.

## Verdict in one line
Every 9c8f10e finding (2×P1, 2×P2, all P3s) is fixed, and I verified each one independently.
M4.3 portfolio and M4.4 replay pass.
**M4.5 autopilot fails the "stop is reliable" bar:**
- a kill or disable that lands during a rotation leaves a fresh, untracked run running (P1);
- overlapping steps start two runs (P2);
- a rotation overrides a user pause or a risk halt (P2).
It is paper-only, so no funds are at risk.

## Checks (5d5c80f)
| Check | Result |
|---|---|
| vitest | 331/331 (35 files) |
| forge (run from `foundry/`) | 54/54 (4 suites) |
| typecheck (root + contracts) | clean |
| lint | OK |
| npm audit | 0 vulnerabilities |
| fixtures:check | 28 files up to date, M4.5 fixtures OK |
| My probes (`test/robin/`) | 60/64. The 4 failures are the old 9c8f10e PoCs whose assertions encoded the bugs, and they now flip, which is the expected result. All 35 new assertions pass. |

## Diff review: 9c8f10e..5d5c80f (27 files, +1302/−62)
Files touched:
- `alerts/service.ts`, `ssrf.ts`
- `app.ts` (portfolio, replay and autopilot routes, plus `startRunFor`)
- `autopilot/service.ts`, `replay/replay.ts`
- `runs/manager.ts`, `executor.ts`, `risk.ts`
- the session-key 503 text
- tests m421, m43, m44, m45

What looks right:
- Portfolio is scoped by `ownerId`, and replay goes through `ownRun`.
- `startRunFor` forces paper mode and enforces the owner check, the active-run cap and one run per strategy.

Concerns, all in `autopilot/service.ts`:
- `step()` has no per-user mutex.
- After `await stop()`, the code does not re-check `killed`/`enabled` before `launch()`.
- `setInterval(stepAll, 30s)` does not wait for the previous pass, and PUT `/autopilot` calls `step()` concurrently.

## Re-verification of 9c8f10e findings
I ran my original PoCs (`robin-g9c8-*`), not only Sage's ports.

| Finding | Status | Evidence |
|---|---|---|
| P1 webhook lookup ignores `{all:true}` | **Fixed** | Real TLS delivery on Node 24.22.1 works: a 500 is retried, then delivered; the HMAC verifies; `x-quiver-delivery` keeps the same id on the retry. The default transport now fails only on my self-signed cert, never "Invalid IP". The old PoC flips. |
| Test allowance off in prod | **Fixed** | Under `NODE_ENV=production`, testAllow is ignored (0 hits). It is also not wired in `createApp`. |
| P1 halt race on approve | **Fixed** | Approve returns 409, the approval stays pending, 0 fills. After resume, approve returns 200 with 1 fill. An executor-level decide on a halted executor gives 0 fills and a run_halted event. |
| P2 pause race | **Fixed** | Approve returns 409, pending, 0 fills. Pause returns in under 150 ms while the chain is blocked for 300 ms. Reject still works while paused. `gate()` returns run_halted/run_paused, lets reducing orders through, and checks kill_switch first. |
| P2 slow-trickle stall / deadline / cap | **Fixed** | The trickle receiver is cut at 10,004 ms ("deadline exceeded"). A server that never responds is cut at the configured deadline. 64 KB+1 is refused as "too large"; exactly 64 KB gets 200. The other user's alert was delivered in 20 ms while the evil delivery was in flight. A second round does not double-send. |
| P3 allowlist (IPv6, 6to4, Teredo, NAT64, TEST-NET, `[::127.0.0.1]`) | **Fixed** | My full blocked and allowed lists pass. `resolvePublic` rejects mixed DNS answers. |
| P3 trailing dots | **Fixed** | Every trailing-dot form is refused at the shape check. |
| P3 503 text | **Fixed** | The body is "Wallet signing is temporarily unavailable on this server. Try again later." with no env var name. |
| P3 delivery id | **Fixed** | Stable across retries. |
| P3 resolved-approval cap | **Fixed** | After expiring 351 approvals, 200 resolved are kept, plus the 2 pending. |
| P3 pause survives restart | **Fixed** | Restored as paused, with 0 intents or fills over 30 ticks. |

## New slices
**M4.3 portfolio: PASS.**
- A second user sees `[]` items, $0 totals, `[]` allocation and `[]` history.
- Bad `mode` or `points` values return 422.
- Totals equal the sum of items for starting equity, equity, PnL, realized, unrealized and fees, including a stopped run. For each item, pnl = equity − starting.
- Allocation weights sum to 100, and history respects `points`.

**M4.4 replay: PASS.**
- Another user gets 404. POST/PUT/DELETE return 404 or 405.
- maxFrames 0 or 2001, frameMs 999 or 86,400,001, a garbage `from`, and to<from all return 422.
- The output is capped at 2000 frames (`truncated:true`, about 490 KB at the maximum).
- The digest is deterministic, and replay writes no events (read-only, so it cannot trigger anything live).

**M4.5 autopilot: FAIL.**

What holds:
- PUT with live, testnet or junk modes returns 403/422. On a testnet-mode server it still starts paper only, with no session key.
- With the platform kill switch on, it starts nothing.
- A normal (non-racing) kill stops and flattens the run. Re-enabling needs acknowledgeKill (409 without it), and nothing restarts over later steps.
- The start-failure loop disables itself, and the log is capped at 500.

## Findings
| Sev | Area | Finding | PoC (`qa/poc/robin-g5d5-m43-45.test.ts`) | Fix |
|---|---|---|---|---|
| **P1** | autopilot | **Kill/disable during a rotation leaves an orphan.** `step()` awaits `stop()` on the old run. If the user kills or disables while that is in flight, the call returns 200 `killed:true, enabled:false, currentRunId:null`, but `launch()` then starts a new run anyway. That run keeps trading with no autopilot tracking and no guardrails. Disable has the same effect. | "kill while a rotation is mid-stop", "disable racing a rotation" | Add a per-user mutex across step, put, disable and kill. After every await, re-check `enabled && !killed` before `launch()`. Kill should also stop any run with `startedBy=autopilot`. |
| **P2** | autopilot | **Overlapping steps.** Two concurrent `step()` calls (the 30 s timer while a slow pass is still running, or the timer plus PUT) both rotate. Result: 2 live autopilot runs, 1 untracked, and `rotationsToday` counted twice. | "overlapping steps" | Same mutex, plus an in-flight guard in `stepAll`. |
| **P2** | autopilot | **Rotation overrides pause and halt.** A run the user paused, or one that was risk/geo-halted, is stopped at the next rotation and replaced by a fresh running run. | "user PAUSED…", "HALTED run…" | Skip rotation, or disable autopilot, when the current run is paused or halted. Log it as a decision. |
| P3 | autopilot | **Restarts bypass the rotation cap.** When a run is stopped elsewhere, every 30 s step starts a new one, and none counts toward `maxRotationsPerDay`. With the cap set to 1, I got 20 restarts in 20 steps (`rotationsToday` 0). | "stopped elsewhere…" | Count these restarts, or disable after N. |
| P3 | autopilot | **Restart leaves an orphan.** Autopilot state is in memory only (documented), but dev persistence restores its run as running with no guardrails or rotation. | "restart…" | On restore, stop runs with `startedBy=autopilot`, or restore them paused. |
| P3 | autopilot | **Approvals are always auto.** `startRunFor` hard-codes approvalMode "auto", and a requested `confirm_each` is silently ignored. Session-key caps don't apply because it is paper only. | "approvals…" | Document this, or pass approvalMode through. |
| P3 | alerts | **Global delivery cap is per round.** 8 per round, but overlapping rounds (timer plus `/alerts/test`) peaked at 16. | `robin-g5d5-m421-alerts.test.ts` | Use a service-wide semaphore. |
| P3 | alerts | **`/alerts/test` can hang.** POST `/alerts/test` awaits a full `process()`, so it can wait behind other users' slow destinations, up to the 10 s deadline per serial delivery (from reading the code). | n/a | Deliver only that user's test, or return 202. |
| P3 | alerts | **No DNS deadline.** `resolvePublic` has no timeout. | n/a | Wrap it in the delivery deadline. |

## Verdict
**FAIL** because of the P1 autopilot kill/disable race. The P2s should be fixed in the same pass, since the mutex plus a post-await re-check covers the P1 and the overlap. All M4.2.1 fixes and M4.3/M4.4 are approved as they stand.

PoCs in `qa/poc/`:
- `robin-g5d5-m421-alerts.test.ts`
- `robin-g5d5-m421-runs.test.ts`
- `robin-g5d5-m43-45.test.ts`
- `robin-g5d5-certs/`: a self-signed test cert, with no secrets.
