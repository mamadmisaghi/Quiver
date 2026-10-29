# Sage — M4 slice contract notes (backend /workspace/quiver/backend)

## M4.0 Alerts
- Schemas: contracts/src/alerts.ts (AlertSettings, PutAlertSettingsReq/Res, CreateAlertRuleReq, AlertRule, AlertDelivery(List), AlertWebhookPayload). Routes under /v1/alerts/* (settings, rules, deliveries, test). New error: `alert_url_blocked` (422).
- Provider by env `ALERTS_PROVIDER` (webhook | email | telegram). Email/telegram = stubs → `not_configured`. Placeholders: ALERTS_EMAIL_API_KEY, ALERTS_TELEGRAM_BOT_TOKEN (unused).
- Webhook: per-user URL, per-user `whsec_` secret shown once, `X-Quiver-Signature: v1=HMAC-SHA256(secret, "ts.body")`. SSRF guard + pinned connection. Retry 10s/60s/5m/30m, 5 attempts max.
- Rules hook into every run event (RunManager onEvent). In-memory only (not in the dev snapshot yet).
- Fixtures: contracts/fixtures/alerts.*.json. Tests: test/integration/m40.test.ts.

## M4.1 Partial close
- `POST /v1/runs/:id/positions/close {instrument, pct}` → ClosePositionRes (contracts/src/api.ts). Paper only (403 mode_not_enabled otherwise); 409 when stopped; 404 when no position.
- Goes through the engine (intent+fill events, serialized with ticks). Remainder < $1 → full close. Allowed when paused/halted.
- Fixture: runs.position-close.json. Tests: test/integration/m41.test.ts.

## M4.2 Approvals
- Start a paper run with `approvalMode: "confirm_each"` (TTL 30..3600s, default 300). Opening orders then emit `approval_requested` and wait. They do not trade until the user approves.
- Check: approve gives approval_resolved → intent → fill with the same orderId. Reject gives no fill. Waiting past the TTL makes approve return 409 and the status read "expired". On a paused run, approve returns 409. Stopping the run cancels pending items. Another user gets 404.
- Closes, exits and flatten bypass approval. Pending items are capped at 20 per run (`approval_queue_full`).
- Pending items are stored in memory only, so a restart loses them (same as runs).

## M4.3 Portfolio views
- Open `/v1/portfolio/runs`, `/v1/portfolio/allocation?by=venue|asset_class|instrument` and `/v1/portfolio/history?points=N`.
- Check:
  - The `/runs` totals equal the sum of its rows, and stopped runs still appear (frozen at stop).
  - Allocation weights add up to about 100%, gross = long + short, sorted largest first.
  - History timestamps go up strictly, `activeRuns` falls when a run stops, and another user sees empty lists.
- Read-only; no new state.

## M4.4 Replays
- Call `/v1/runs/:id/replay?frameMs=60000` twice; the output and `digest` should be identical.
- Check:
  - Summing `counts.fills` equals the number of fill events.
  - The last frame's positions match the final positions.
  - `maxFrames=5` gives the first 5 frames with `truncated: true`.
  - With `from=<frame10 ts>`, frame 0 has frame 10's positions.
  - Another user gets 404.
- Read-only.

## M4.5 Autopilot (paper only)
- `PUT /v1/autopilot {enabled: true, strategyIds: [a, b, c], rotateEveryMin: 15}`.
- Check:
  - It runs a then b then c then a, one paper run at a time, and the old run is stopped and flattened.
  - `maxRotationsPerDay: 1` gives `skipped` on the second rotation, and the run keeps going.
  - A drawdown or daily-loss breach gives `guardrail_stop`, a disabled autopilot and no live runs.
  - `POST /autopilot/kill` stops the run, and re-enabling returns 409 until `acknowledgeKill: true`.
  - With the platform kill switch on, no rotations happen.
  - A mode of `live` or `testnet` returns 403.
- State is in memory only.

## M4.2.1 — fixes for Robin's gate on 9c8f10e
- **P1-1:** `makeHttpsTransport`'s pinned lookup now handles `{all:true}` and returns `[{address,family}]`.
  - The new test m421 runs against a real local TLS server with a self-signed cert. The cert is generated per run in a tmpdir with openssl and is never committed.
  - The test-only `TestAllow {addresses, ports}` allowance is ignored when NODE_ENV=production.
- **P1-2 / P2 pause race:**
  - `decideApproval` checks again on the chain (paused/halted/stopped/aborted, or `ex.halted`) and returns 409 while keeping the approval pending.
  - Pause is now immediate.
  - The risk gate adds `run_halted` and `run_paused` for non-reducing orders.
  - Robin's two FINDING PoCs are ported and now assert the safe outcome. The one-line repro from `robin-g9c8-pin-plain.ts` is ported too.
- **P2 slow receiver:** each attempt has a 10 s total deadline (timer + AbortController + socket destroy) and a 64 KB response cap. Deliveries are queued per destination with 8 global workers, and a delivery that is in flight is never picked twice.
- **P3:**
  - SSRF now uses a global-unicast allowlist with IPv6 expansion (mapped/compat in any notation, 6to4, Teredo, NAT64, fec0, 100::/64, TEST-NETs, 240/4).
  - Trailing-dot hostnames are normalised.
  - The 503 message is generic.
  - The delivery id is documented as stable across retries, with a dedupe rule.
  - Resolved approvals are capped at 200 per run.
  - A paused run stays paused after a dev restart.
- **Note for Robin:** the probe files `poc/robin-g9c8-m42-races.test.ts` (the two FINDING cases) and the `pin-plain` repro assert the OLD behaviour, so they are now expected to fail or flip.
- **Checks:** vitest 331/331 (35 files), forge 54/54, typecheck and lint clean, fixtures 28 OK.

## M4.5.1 — autopilot and alerts gate fixes (Robin gate 5d5c80f)
- **P1:**
  - Kill and disable during a rotation now leave 0 live runs.
  - Each user has a mutex. Kill and disable set their flags and bump an epoch synchronously, and every await re-checks the state. A run that started late is stopped.
  - Kill stops all runs autopilot owns.
- **P2:**
  - `step`/`stepAll` are single-flight, so a rotation is counted once.
  - Paused or halted runs are skipped and the skip is logged.
- **P3 decisions:**
  - An external stop **disables** autopilot.
  - The autopilot state persists with the dev store, and `reconcile()` runs on restore.
  - `confirm_each` is **respected** and passed through to the run.
  - The global alert limit of 8 uses a semaphore.
  - `/alerts/test` uses `deliverNow(id)`.
  - DNS has a 3 s timeout and is retryable.
- **Tests:** `test/integration/m451.test.ts` (13) ports `poc/robin-g5d5-m43-45` with the safe expectations. Robin's g5d5 FINDING probes now fail or flip, as expected.

## M4.5.2 — landing and ops follow-ups (Robin gate 5114786)
- The landing notice now follows `PRICE_SOURCE`, so the VPS (mainnet-readonly) no longer says "synthetic (mock) prices".
- A null preview is cached for 60 s instead of 1 h.
- New `scripts/ops/stop-api.cmd`: no PowerShell, uses curl.exe, CRLF line endings. It takes args, then env, then the defaults 8987/QuiverApi. The `.ps1` defaults were fixed the same way. OPS.md was updated. It did not list the VPS port or task before, so the values come from the gate report.
- **Tests:** `test/integration/m452.test.ts` (4).

## M3.9 — session-key prepare (audit done in M4.6)
- Verified shipped and covered in test/integration/m39.test.ts: maxSlippagePct ≤ account cap and ≤2dp (422 session_key_slippage_above_cap); daily ≤ 64× per-trade (422 session_key_cap_ratio); expiry defaults to 24h, max 168h (422 session_key_expiry_too_long); testnet signing is client-side only (prepare returns calls/typed data, submit verifies signature + policyHash, install via wallet_sendCalls; 503 signing_unavailable without config). No keys on the server.
- Gap fixed in M4.6: config defaults could break these rules; boot now rejects them (test in m46).
- Note on this file: it has been at this path since M4.0 (last appended 09:22 Asia/Tehran on Oct 28); it just had no M3.9 section before.

## M4.6 — Wren's API gaps
- 409 approve: details.runStatus (paused|halted|stopped|aborted) + haltReason; message kept.
- Approval: strategyId, strategyName, actionTitle.
- Autopilot: state.currentStrategyName; decisions/log: strategyName, fromStrategyName, toStrategyName.
- GET /v1/positions?mode&runId and GET /v1/runs/:id/positions (OpenPosition shape in api-contracts.md).
- Fixtures: approvals.conflict.json, positions.paper.json; approvals/autopilot fixtures regenerated. Tests: test/integration/m46.test.ts (5).

## M4.7 — trigger snapshot + approval_requested names
- SSE connect/resume snapshot now ends with a `triggers_snapshot` frame (no id) carrying TriggerStateItem[]; GET /v1/runs/:id has `triggerStates` ([] when stopped).
- approval_requested event: `strategyName`, `actionTitle` (title builder moved to src/sim/titles.ts, shared with the Approval view).
- Fixtures: runs.get.json, events.connect-snapshot.json, events.approval-requested.json. Tests: test/integration/m47.test.ts (3).

## M4.8: public leaderboard and share cards
- GET /v1/public/leaderboard: no auth, 30/min/IP, 60 s cache. Opt-in public strategies only, paper or backtest basis, minTrades (LEADERBOARD_MIN_TRADES=3), ranked by returnPct. Handles only; email-like labels are hashed.
- POST/DELETE /v1/runs/:id/card/share (owner, audited); GET /v1/public/cards/:token returns a sanitized card (percentages and counts, no ids/USD). Revoke gives 404.
- The share tokens map is persisted with the dev store. m34 public-route allowlist: added /public/leaderboard and /public/cards/:token.
- Tests: test/integration/m48.test.ts (4): ranking, threshold, opt-in, cache, leak regex, email-handle hashing, paper basis, 429, share/revoke/IDOR.

## M4.9 — Instruct (POST /runs/:id/instruct → /apply)
- Flow: propose (diff only), then explicit apply. Apply creates a new strategy version through the same validation as create and swaps the live paper run onto it (`warning` code `strategy_updated`).
- Prompt-injection safety: the output is a closed strict op union (ids plus bounded numbers, no strings reach the strategy). The model sees an id outline, not the thesis or names. Invalid or unknown-id AI output falls back to the demo parser.
- Guards: paper only; owner only (404 otherwise); 409 if stopped, stale (superseded), expired (15 min) or already applied; rate limits 10/min and 100/day (propose), 10/min (apply); audited.
- Tests: test/integration/m49.test.ts (3 tests: happy path, guards/staleness/expiry, injection). Fixtures runs.instruct.json and runs.instruct-apply.json.
- QA try: "Change size to $300", "stop loss 5% take profit 12%", "2x leverage", "pause the BTC rule", "cooldown 120 minutes", "daily loss limit 5%".

## M4.9.1 — Robin's lows on aaa21a4 + friendly instruct errors
- Errors: src/lib/issues.ts maps zod issues to stable codes and friendly messages, de-duplicated (no raw zod text anywhere). An instruct change that leaves zero rules returns `422 strategy_invalid` with a single `strategy_needs_rule` issue.
- B1: LLM cost is reserved before each call (`LLM_EST_CALL_USD`) and settled after. B2: instruct counts toward `LLM_USER_DAILY_COMPILES`. B3: unsafe handles use an HMAC alias. Card cache max-age is now 5.
- Kill:
  - `stop_and_flatten` is bounded at 5 s (`flatten_timeout` warning).
  - `/autopilot/kill` returns 207 with `kill.failed[]` when a stop throws, and the rest still stop.
  - `stepAll` runs users in parallel (cap 8) with a 20 s timeout per user.
- stop-api.cmd: token comes from a file through a temporary curl config (never in argv); the wait uses ping (works over WinRM).
- be.tgz deleted and gitignored.
- Tests: test/integration/m491.test.ts (7) and test/unit/m491-autopilot.test.ts (3).
- QA try:
  - Instruct "pause rule <every trigger id>" → 422 with one friendly issue.
  - PUT a strategy with `triggers: []` → `strategy_needs_rule` only.
  - Instruct past the daily quota → 429.

## M4.9.2 — Robin's findings on 485da53
1. LLM budget: the estimate floor is $0.50, with an optional priced worst case (max tokens × price) and `max_tokens` on every call. `LLM_MAX_INFLIGHT` (4) caps concurrent calls; overflow gets the demo compiler ("busy"). Reservation never exceeds the remaining budget. Tests: 12 concurrent at $0.40 against a $1 cap stay ≤ $1, at most 3 in flight with cap 3, the priced estimate allows 1 call, and a $0.05 estimate is raised to $0.50.
2. A 422 instruct (`unsupported_prompt` or `strategy_invalid`) refunds the compile quota. Test: 8 refused calls, then 2 valid calls → 201, 201, then 429.
3. Late flatten: chose to **block**. The executor is frozen when the run stops; late fills are counted in `blockedFills` and never applied. Test: quote 150 ms, cap 30 ms → positions and fills unchanged and no events after `stopped`. A control run with the freeze disabled fails the test.
- Files: test/integration/m492.test.ts (5), test/unit/m492-late-flatten.test.ts (1).

## M5.0 — read-only testnet 46630 adapter + AA on anvil
- Check: `GET /v1/chain/testnet/status` (default off → reachable:false + reason; tradable always false; V1–V11 listed).
- With `CHAIN_READS_ENABLED=true` on a box with network: reachable:true, chainIdMatches:true, block number set. Wrong RPC (e.g. mainnet) → chainIdMatches:false.
- `/accounts/:address`: EOA → no_code; random contract → mismatch, account null; 9 tokens → 422; reads off → 503.
- Tests: test/unit/m50-reader.test.ts (guard refuses send/sign before I/O, chain pin, timeout), test/integration/m50-anvil-readonly.test.ts (SessionAccount deployed+granted on anvil, read back via adapter + HTTP; hash mismatch fails closed; guarded send never reaches anvil).
