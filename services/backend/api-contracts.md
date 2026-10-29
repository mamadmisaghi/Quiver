# Quiver API contracts v1 (DRAFT)

The types live in `contracts/src/*.ts`, as zod schemas plus inferred TypeScript types. **They are the source of truth.** If this doc and the code disagree, the code wins, and the doc is a bug.
- Base URL: `/v1`. JSON over HTTPS.
- Decimal money and quantity values are **strings** (`"500.00"`).
- Times are ISO-8601 UTC.
- IDs are prefixed (`stg_`, `run_`, `ord_`, `fil_`, `bkt_`, `cmp_`, `sk_`, `usr_`).

## 0. Conventions
- **Auth:** `Authorization: Bearer <accessToken>` (15-minute JWT). The refresh token is an httpOnly `SameSite=Strict` cookie, used via `POST /v1/auth/refresh`.
- **Errors:** every non-2xx response uses the body below. Codes and HTTP statuses are in `contracts/src/errors.ts` (`HTTP_STATUS`).
  ```json
  { "error": { "code": "geo_restricted", "message": "Stock Tokens aren't available in your region.", "requestId": "req_7f3a…" } }
  ```
  Notable codes:
  - 422 `validation_failed` / `strategy_invalid`, with `details: ValidationIssue[]`;
  - 429 `rate_limited`, with `retryAfterSec`. **M3.6.1:** every 429 (`rate_limited`, `limit_exceeded`, `compile_quota_exceeded`, …) also sends a `Retry-After` header in whole seconds (≥ 1), equal to `error.retryAfterSec` (60 when there is no natural window, e.g. the active-run cap);
  - 451 `geo_restricted`;
  - 403 `mode_not_enabled` (testnet/live not yet unlocked);
  - 412 `session_key_*`;
  - 409 `conflict` (version mismatch) and `run_already_active`.
- **Pagination:** cursor-based. Query: `?limit=25&cursor=<opaque>`. Response: `{ items: [...], nextCursor: string | null }`. Results are newest first, and `limit` is at most 100.
- **Idempotency:** `POST`s that create things accept an `Idempotency-Key` header (UUID), which is kept for 24 h.
- **Rate limits (default):**
  - 60 req/min per user;
  - compile: 6/min and a daily quota (`me.quotas`);
  - backtest: 3 concurrent.

## 1. Auth
| Method | Path | Body → Response |
|---|---|---|
| POST | `/auth/exchange` | `AuthExchangeReq` → `AuthExchangeRes` |
| POST | `/auth/refresh` | cookie → `{ accessToken, expiresAt }` |
| POST | `/auth/logout` | → 204 |
| GET | `/me` | → `Me` |
| POST | `/me/eligibility` | `EligibilityDeclareReq` → `Me` (the server combines this with IP geo) |
| POST | `/stream-tickets` | `{ runId }` → `{ ticket, expiresAt }` (60 s, single run; used by EventSource) |

```http
POST /v1/auth/exchange
{ "provider": "privy", "idToken": "eyJhbGciOi…" }
→ 200
{ "accessToken": "eyJ…", "expiresAt": "2026-10-27T09:45:00Z",
  "me": { "id": "usr_01HZX0A1B2C3D4", "createdAt": "2026-10-27T09:30:00Z", "displayName": null,
    "wallets": [{ "chain": "robinhood", "address": "0x1111111111111111111111111111111111111111", "kind": "embedded" }],
    "eligibility": { "country": "DE", "selfDeclaredNonUsPerson": false, "stockTokens": "unknown", "reason": "Declaration required" },
    "enabledModes": ["paper"], "quotas": { "compilesPerDay": 30, "compilesUsedToday": 0 } } }
```

## 2. Compile (natural language → strategy), streaming
`POST /compile` with body `CompileReq` responds with `Content-Type: application/x-ndjson`: one `CompileEvent` per line. Guests are allowed (IP-limited, 3/day). The result can then be saved after login.
Refine: send the same endpoint `baseStrategy` + `instruction`.
```http
POST /v1/compile
{ "thesis": "If Fed-cut odds on Polymarket pass 70% and NVDA trades under its 20-day average, buy $200 of NVDA…" }
→ 200 (stream)
{"type":"progress","step":"reading","label":"Reading your thesis","attempt":1}
{"type":"progress","step":"resolving_markets","label":"Resolving markets on 3 venues","attempt":1}
{"type":"partial","node":{"id":"fed_odds","kind":"watch","title":"Fed cut odds","detail":"Dec meeting · YES","venue":"polymarket"}}
{"type":"progress","step":"choosing_feeds","label":"Choosing price feeds (Chainlink · Hyperliquid · Polymarket)","attempt":1}
{"type":"progress","step":"writing_rules","label":"Writing triggers and exits","attempt":1}
{"type":"progress","step":"checking_risk","label":"Checking risk limits","attempt":1}
{"type":"result","compileId":"cmp_01HZX1A2B3C4","strategy":{…Strategy…},"humanized":{"watch":["…"],"when":["…"],"do":["…"],"exit":["…"]},"issues":[],"usage":{"attempts":1,"inputTokens":2140,"outputTokens":980,"costUsd":"0.012"}}
```
- `step: "repairing"` appears when the validator sent issues back to the model (at most 2 repairs).
- A terminal `error` carries one of `compile_failed`, `compile_quota_exceeded` or `compile_cost_cap`.
- `partial.node` uses the same `{id, kind: watch|when|do|exit, title, detail, venue}` shape as `web/lib/mock.ts` `GNode`. Draw ghost nodes until `result` arrives.
- Abort by closing the request (AbortController).

## 3. Validate
`POST /strategies/validate` with body `{ strategy }` returns `ValidateRes`. It always responds 200 with `ok: boolean`, and it is safe to call on every edit (debounce 400 ms).
```json
{ "ok": false, "strategy": null, "humanized": null,
  "issues": [{ "path": "/actions/0/instrument", "code": "geo_restricted", "severity": "error", "message": "NVDA Stock Token isn't available in your region." }] }
```

## 4. Strategies CRUD
| Method | Path | Body → Response |
|---|---|---|
| GET | `/strategies?status=&limit=&cursor=` | → `Page<StrategySummary>` |
| POST | `/strategies` | `CreateStrategyReq` → 201 `StrategyRecord` |
| GET | `/strategies/:id` | → `StrategyRecord` (latest version) |
| GET | `/strategies/:id/versions/:v` | → `StrategyRecord` |
| PUT | `/strategies/:id` | `UpdateStrategyReq` (`expectedVersion`) → `StrategyRecord` (version + 1), or 409 `conflict` |
| DELETE | `/strategies/:id` | → 204 (archives; 409 `run_already_active` if running) |

## 5. Backtest
| Method | Path | |
|---|---|---|
| POST | `/backtests` | `BacktestReq` → 202 `BacktestRes` (`status: queued`) |
| GET | `/backtests/:id` | → `BacktestRes` (poll every 1 s, or use the SSE below) |
| GET | `/backtests/:id/events` | SSE: `event: progress` `{progress}` and then `event: done` `BacktestRes` |
| POST | `/backtests/:id/cancel` | → `BacktestRes` |

`result.caveats` is always non-empty, so render it. `dataCoverage[].synthetic: true` means modeled data: show a badge.

## 6. Runs: paper start/stop (testnet/live use the same API, gated)
| Method | Path | |
|---|---|---|
| POST | `/runs` | `StartRunReq` → 201 `Run`. `mode: "testnet" \| "live"` returns 403 `mode_not_enabled` until it is unlocked. Live also needs `sessionKeyId` |
| GET | `/runs?strategyId=&mode=&limit=&cursor=` | → `Page<Run>` |
| GET | `/runs/:id` | → `Run` |
| POST | `/runs/:id/control` | `{ action: pause \| resume \| stop \| stop_and_flatten }` → `Run` |
| GET | `/runs/:id/events?since=<seq>&limit=` | → `Page<RunEvent>` (polling fallback) |
| GET | `/fills?runId=&mode=&limit=&cursor=` | → `Page<fill>` |

```http
POST /v1/runs
{ "strategyId": "stg_01HZX2A3B4C5", "mode": "paper", "paper": { "startingEquityUsd": "10000" } }
→ 201 { "id": "run_01HZXK8P2Q4M", "strategyId": "stg_01HZX2A3B4C5", "strategyVersion": 3, "mode": "paper",
        "status": "starting", "startedAt": "2026-10-27T09:30:00Z", "stoppedAt": null, "lastSeq": 0,
        "equityUsd": "10000", "pnlUsd": "0", "pnlPct": "0" }
```

## 7. Live event stream (SSE)
`GET /v1/runs/:runId/events/stream?ticket=<stream ticket>` (canonical). Alias: `GET /v1/runs/:runId/events?ticket=…` (or `Accept: text/event-stream`) serves the same SSE stream; without a ticket/SSE accept header, `/events` is the JSON polling route. Get the ticket from `POST /stream-tickets`, because EventSource can't send headers. Never put the access token in the URL.
- Each frame has the form `id: <seq>\nevent: <type>\ndata: <RunEvent JSON>\n\n`.
- To resume, the browser sends `Last-Event-ID` automatically. After a full reload, pass `&since=<seq>`.
- A `heartbeat` arrives every 15 s. Show "Offline" after 45 s without any frame.
- The first frames after connect are a `status` plus a full-snapshot `tick`.
- All payloads share `{ v: 1, seq, runId, mode, ts, type }`. The full set (from `contracts/fixtures/events.paper.ndjson`):

**tick**: one per cycle (about 15 s). `signals` holds changed values only. A `value: null` / `stale: true` value is unknown, so render it as "waiting for data".
```json
{"v":1,"seq":1,"runId":"run_01HZXK8P2Q4M","mode":"paper","ts":"2026-10-27T09:30:15Z","type":"tick","cycle":1,
 "signals":[{"signalId":"nvda_px","field":"value","value":181.42,"observedAt":"2026-10-27T09:30:14Z","source":"chainlink_stream","stale":false}],
 "triggers":[{"triggerId":"t1","state":"ready","conditionTrue":true,"heldForSec":0,"cooldownUntil":null,"fires":0}]}
```
**trigger_met**: the condition just became true. `path` lists the node ids to light up as hot edges. When `forMinutes > 0`, show a countdown to `holdUntil`.
```json
{"v":1,"seq":2,"runId":"run_01HZXK8P2Q4M","mode":"paper","ts":"2026-10-27T09:30:15Z","type":"trigger_met","triggerId":"t1","forMinutes":15,"holdUntil":"2026-10-27T09:45:15Z","path":["fed_odds","nvda_px","nvda_sma20","sol_funding","t1"]}
```
**trigger_fired**
```json
{"v":1,"seq":61,"runId":"run_01HZXK8P2Q4M","mode":"paper","ts":"2026-10-27T09:45:15Z","type":"trigger_fired","triggerId":"t1","fireIndex":1,"actionIds":["a1","a2"],"intentIds":["ord_01HZXM0A1B2C","ord_01HZXM0D3E4F"]}
```
**intent** / **rejected**: the order passed (or failed) the risk gate.
```json
{"v":1,"seq":62,"runId":"run_01HZXK8P2Q4M","mode":"paper","ts":"2026-10-27T09:45:15Z","type":"intent","orderId":"ord_01HZXM0A1B2C","actionId":"a1","instrument":"robinhood:token:0x00000000000000000000000000000000000000a1","venue":"robinhood","side":"buy","notionalUsd":"200","maxSlippageBps":50}
```
**fill**: `simulated: true` in paper (`txHash: null`). Live fills carry `txHash` + `explorerUrl` (Blockscout); always link them.
```json
{"v":1,"seq":63,"runId":"run_01HZXK8P2Q4M","mode":"paper","ts":"2026-10-27T09:45:16Z","type":"fill","fillId":"fil_01HZXM0G5H6J","orderId":"ord_01HZXM0A1B2C","actionId":"a1","instrument":"robinhood:token:0x00000000000000000000000000000000000000a1","venue":"robinhood","side":"buy","qty":"2.7524","price":"181.6","notionalUsd":"499.84","feeUsd":"1.50","slippageBps":9.9,"referencePrice":"181.42","referenceSource":"chainlink_stream","simulated":true,"txHash":null,"explorerUrl":null,"position":{"qty":"2.7524","avgEntry":"181.6","unrealizedPnlUsd":"-0.50"}}
```
**error**: `retryable: true` means the engine retries by itself, so show it as a transient toast.
```json
{"v":1,"seq":64,"runId":"run_01HZXK8P2Q4M","mode":"paper","ts":"2026-10-27T09:45:16Z","type":"error","code":"venue_unavailable","message":"Hyperliquid quote timed out. Retrying in 5 s.","retryable":true,"orderId":"ord_01HZXM0D3E4F"}
```
**risk_halt**: the run is now `halted`. Show a persistent banner with a Resume button (`POST /runs/:id/control {action:"resume"}`).
```json
{"v":1,"seq":90,"runId":"run_01HZXK8P2Q4M","mode":"paper","ts":"2026-10-27T13:02:40Z","type":"risk_halt","rule":"max_daily_loss","observed":"10.4","limit":"10","flattened":false,"message":"Daily loss reached 10.4% (limit 10%). New orders are paused until you resume."}
```
The remaining run-log event types are `status` and `warning`. The stream also carries two control frames that are NOT run-log events (no `seq`/`id`, never replayed, parse with `RunStreamFrame`): `heartbeat` `{type, ts, lastSeq}` and `resync` `{type, reason, lastSeq, reconnectWithLastEventId}`.
**Graph mapping for `StrategyGraph`:**
- Node ids equal strategy-local ids: signals are `watch`, triggers `when`, actions `do`, exits `exit` (as `<actionId>.exit`).
- `trigger_met` sets the trigger node to "met" and its `path` edges to hot.
- `trigger_fired` sets the action nodes to "active".
- `fill` shows PnL on the action node.
- A `rejected` or `error` with an `orderId` flashes the action node in the short colour.

## 8. Session keys (trade-only)
| Method | Path | |
|---|---|---|
| POST | `/session-keys/prepare` | `PrepareSessionKeyReq` → `PrepareSessionKeyRes` (show `humanReadable` + `policy`; the user signs `signatureRequest` in their wallet) |
| POST | `/session-keys/submit` | `SubmitSessionKeyReq` → `SessionKey` (`pending` → `active` after on-chain confirmation; poll `GET`) |
| GET | `/session-keys` | → `Page<SessionKey>` |
| GET | `/session-keys/:id` | → `SessionKey` |
| GET | `/session-keys/defaults` | → `SessionKeyDefaults` (M3.6.1; form prefill) |
| DELETE | `/session-keys/:id` | → `RevokeSessionKeyRes` (the off-chain revoke is immediate. If `onchainRevoke` is present, ask the user to sign it as well) |

`humanReadable` example:
```json
["Can swap on Uniswap and 0x on Robinhood Chain",
 "Only these tokens: USDG, NVDA, AAPL",
 "Up to $250 per trade, $1,000 per day",
 "Expires Nov 3, 2026",
 "Cannot transfer or withdraw. Swap output always returns to your account."]
```
**M3.6.1 fields.**
- `policy.maxSlippagePct` (number, percent): on `PrepareSessionKeyRes.policy` and `SessionKey.policy`. Comes from the SessionAccount's slippage cap (`slippageCapBps / 100`); `1` when unset, up to `10` when the owner raised it via `setSlippageCap`.
- `SessionKeyDefaults` (`GET /v1/session-keys/defaults`, and `PrepareSessionKeyRes.defaults`), same numbers as SIGNOFF M3.6:
  ```json
  { "perTradeCapUsd": 250, "dailyCapUsd": 1000, "minSwapUsd": 15.63, "maxSlippagePct": 1 }
  ```
  `minSwapUsd` = `dailyCapUsd / 64`, rounded up to the cent. Fixture: `contracts/fixtures/session-key.defaults.json`.

The session-key flow returns 403 `mode_not_enabled` until testnet is approved. Build the UI against mocks.

## 9. Venues, markets, quotes
| Method | Path | |
|---|---|---|
| GET | `/venues` | → `VenueInfo[]` (Polymarket: `capabilities: ["read"]`) |
| GET | `/markets?venue=&q=&assetClass=&limit=&cursor=` | → `Page<Market>` (`geoRestricted` / `tradable` per caller) |
| GET | `/markets/:instrumentId` | → `Market` (URL-encode the id) |
| POST | `/quotes` | `QuoteReq` → `QuoteRes` (indicative; `expiresAt` ≈ 15 s). Returns 451 for geo-restricted callers, and 409 `market_closed` is never returned for 24/7 Stock Token pools, but `referencePrice` may be null while the feed is paused |
| GET | `/status` | → `{ ok, venues: VenueInfo[], engineLagSec }` (no auth) |

## 10. Portfolio
`GET /portfolio?mode=paper|testnet|live` → `Portfolio`. Live balances come from the chain via the indexer, so `asOf` can lag by a few seconds.

## 11. Mock mode (build against stubs now)
- The fixtures in `contracts/fixtures/` validate against the schemas (`npm run fixtures:check`):
  - `strategy.nvda-fed.json`: the same scenario as `web/lib/mock.ts`;
  - `events.paper.ndjson`: a full paper run from `status` to `risk_halt`.
- Proposed switch: `NEXT_PUBLIC_API_MODE=mock|live`. In mock mode the web app implements the client against local handlers:
  - (a) `/compile` replays the progress lines from §2 with 400–700 ms delays and returns the fixture strategy;
  - (b) the run stream replays `events.paper.ndjson` on a timer (compress `ts` gaps to 1–2 s) and then loops a `tick` with jittered prices;
  - (c) everything else returns fixture-derived objects.
- Use the zod schemas to `parse()` every mock and every real response in dev, so drift fails loudly.
- All mock data must be labeled `// MOCK`. The NVDA address `0x…00a1` is a placeholder, not a real token.
- When a mock backend is shipped (P1), it will live at `backend/mock-server` and serve these same files. The contracts will not change.

## 12. v1.1 extensions (for the web app; additive)
Schemas: `contracts/src/ext.ts` (new objects) plus defaulted fields on existing ones in `contracts/src/api.ts`. Fixtures are `contracts/fixtures/ext.*.json`, generated from the mock API by `scripts/gen-ext-fixtures.ts` and checked by `fixtures:check`. Every new field on an existing object has a zod default, so v1.0 payloads still parse.

**(a) Equity series.**
- `EquityPoint = {ts, equityUsd, pnlUsd, drawdownPct}`. Values are decimal strings; drawdownPct ≥ 0 is the percent below the running peak.
- `GET /runs/:id/equity?points=2..500` (default 200) returns `EquitySeries {runId, backtestId:null, startingEquityUsd, points[], synthetic}`.
  - Points are oldest first. They are sampled once per engine cycle, plus at start and stop, then downsampled evenly.
- `BacktestRes.result.equitySeries` holds the same points as `equityCurve`, with pnl and drawdown added.

**(b) Sparklines and node titles.**
- `Market.spark: number[]` holds 24 hourly prices, oldest first; the last point is the current price. Numbers are for display only.
- `StrategyRecord.nodes: StrategyNode[]` uses the `partial.node` shape from compile §2: `{id, kind: watch|when|do|exit, title, detail, venue?}`. It is deterministic and returned on every strategy read.
- `StrategyRecord.public: boolean` and `forkedFrom: StrategyId|null` are also added.

**(c) Social layer.** Mock mode serves example data only; nothing here is real performance, income or a promise of returns.
- **Public strategies:**
  - `GET /public/strategies?venue&sort=return_30d|forks|new&limit&cursor` returns `Page<PublicStrategySummary>`. Each summary is `{id, name, author{handle,isYou}, venues, forks, paperReturn30dPct|null, spark, publishedAt, mock}`.
  - `GET /public/strategies/:id` returns `PublicStrategyDetail`: the summary plus `thesis, strategy, humanized, nodes, forkedFrom`.
  - `POST /public/strategies/:id/fork` takes Idempotency-Key and returns 201 with a `StrategyRecord` (private copy, `forkedFrom` set).
  - `POST /strategies/:id/publish {public: boolean}` returns a `StrategyRecord`. It is owner only, and publishing is refused while the strategy has errors.
  - Seed strategies come from placeholder authors (`@demo_*`). `paperReturn30dPct` is a 1h backtest over the last 30 days on the active market data, which is synthetic in mock mode.
- **Leaderboard:** `GET /traders?window=7d|30d|all` returns `{window, basis:"paper", items: Trader[], asOf, mock, notice}`.
  - Each `Trader` is `{rank, handle, isYou, venues, paperReturnPct|null, winRatePct|null, strategies, spark}`.
  - A trader's return is their best public strategy's paper backtest for the window. `all` means the last 90 days in v1.
  - The caller always appears. With nothing published, the return is `null`.
- **Rewards:** `GET /rewards` returns `{mock:true, notice, points:null, season:null, rank:null, quests[{id,title,done}]}`.
  - No program is defined, so points, season and rank stay `null`. Quests reflect real activity in the user's account.
- **Revenue:** `GET /revenue` returns `{mock:true, notice, earnedUsd:"0", claimableUsd:"0", forks, creatorSharePct:null, rows[{strategyId,name,forks,followersVolumeUsd:"0",earnedUsd:"0"}], claimEnabled:false}`.
  - The fee split is to be confirmed, so every amount is zero. Fork counts are real counts from the store.
- **Skills:** `GET /skills` returns `{items: Skill[]}`. A `Skill` is `{id, name, by, desc, venues, blocks, prompt}`, and `prompt` goes to `/compile`.

## M2 note
/v1/markets items may carry priceSource "chainlink_mainnet_readonly" (with priceAt) when PRICE_SOURCE=mainnet-readonly; otherwise mock. See VERIFICATION.md.

## 13. M3 changes (additive)
- `BacktestRes.result.stats` (optional): `sortino, volatilityAnnPct, maxDrawdownDurationHours, closedTrades, profitFactor, avgWinUsd, avgLossUsd, conventions`. Sharpe: sample sd, rf=0, annualised by median sample spacing over 365 days; null if <3 returns or zero variance.
- `BacktestRes.result.costs` (optional): `feesUsd, gasUsd, spreadUsd, impactUsd`.
- `result.coverage[].source` adds `chainlink_mainnet_readonly`, `modeled_eod_tiingo` (label "Modeled"), `none` (no data); `gaps` counts failed/missing rounds.
- New rejection code `market_closed` for Robinhood Stock Token orders (entries and exits) when NYSE is closed or the feed is stale.
- `PricePoint.stale?: true`, `staleReason?: "market_closed"` — last close carried over weekends/holidays.
- `marketSession` honours NYSE holidays and early closes (13:00 close, post until 17:00 ET).
- SSE: `retry: 3000` rides on the first `snapshot` frame (no hello event); `heartbeat` data `{type, ts, lastSeq}` only when idle; new `resync` event `{reason:"slow_consumer", lastSeq, reconnectWithLastEventId:true}` then close — reconnect with `Last-Event-ID`.

## 14. M3.1 changes (Wren's mismatch list)

| # | Change | Contract |
|---|---|---|
| 1 | **Compile never hangs.** No AI key → deterministic keyword "Demo compile" (<200 ms, typically ~15 ms): price above/below $X, % move (+window), crossover (price × N-day SMA/EMA, golden/death cross), above/below N-day average, RSI/oversold/overbought, time-based/DCA (cron timer, `maxFires: null`), TP / SL / trailing / "exit after N days", $ or % of portfolio, perp short + leverage, Fed odds, funding; tickers or names (nvidia, bitcoin…). Unmappable → `error` `{code:"unsupported_prompt", message, suggestions[]}` (no silent fixture fallback). AI path: 8 s per call, 15 s total, then falls back to demo on timeout / network error / invalid output. | `CompileEvent.result` adds `compiler: "ai"\|"demo"` and `notice: string\|null` (show a "Demo compile" label + notice when `compiler === "demo"`). `CompileEvent.error` adds optional `suggestions`. New `ErrorCode` `unsupported_prompt` (422). |
| 2 | **Stream route.** Canonical `GET /runs/:id/events/stream?ticket=`; alias `GET /runs/:id/events?ticket=` (or `Accept: text/event-stream`). | docs only |
| 3 | **Heartbeat** is a control frame `{type:"heartbeat", ts, lastSeq}` (removed from the `RunEvent` union; it never had `seq`). | `HeartbeatFrame` |
| 4 | **Resync** `{type:"resync", reason:"slow_consumer", lastSeq, reconnectWithLastEventId:true}` (server now includes `type`). | `ResyncFrame`; `RunStreamFrame = RunEvent \| HeartbeatFrame \| ResyncFrame` |
| 5 | `SignalValue.staleReason?: "market_closed" \| "no_data"`; `stale` is true whenever a reason is set. | events.ts |
| 6 | `PricePoint` `{value, observedAt, source, stale, staleReason: "market_closed"\|null}`; `Market` adds `priceStale`, `priceStaleReason`. | api.ts |
| 7 | `priceSource` is the `PriceSource` enum: `mock, mock_chainlink, mock_pool, mock_hyperliquid, mock_polymarket, mock_jupiter, chainlink_mainnet_readonly, modeled_eod_tiingo, none`. | api.ts |
| 8 | Fixture `_comment` removed (strategy.nvda-fed.json); fixtures parse strictly. Note: the NVDA address is a MOCK placeholder. | fixtures |
| 9 | **Geo:** eligibility gates live Stock Token execution only. Demo/paper/backtest/quotes/compile never return 451. `Market.tradable` now means "tradable in paper"; `geoRestricted` = live blocked. validate/save add a `geo_restricted` **warning**. | behaviour |
| 10 | **Dev persistence** (mock only): JSON snapshot `.data/dev-store.json` (gitignored), debounced, flushed on exit; running runs resume after restart with a `warning {code:"dev_restart"}` (paper positions reset). Dev JWT secret kept in `.data/dev-jwt-secret` so sessions survive restarts. Disable: `QUIVR_DEV_PERSIST=0`. | env |
| 11 | **Rewards** returns complete EXAMPLE data: `{mock, example:true, notice, points, season{id,name,startsAt,endsAt}, rank, totalParticipants, quests[{id,title,done,points,progress}], history[{at,points,reason}]}`. No nulls. No program is live. | ext.ts `RewardsRes` (breaking: nullable fields became required) |

## 15. M3.2 changes

- **Market**: `name` is a clean display name (no "MOCK"/"Stock Token" markers). New fields `isMock: boolean` (registry placeholder/mock instrument) and `addressVerified: boolean | null` (true only for a token whose address is verified for the active chain; `null` for perps/outcomes, which have no token address).
- **SignalValue.source** is now an enum: `SignalSource = PriceSource ∪ {calendar, timer, portfolio}`. Price/odds/funding signals carry their `PriceSource`; indicators carry the source of their input price (no more `"computed"`). Unknown internal sources fail closed to `"none"`.
- **Notices** (`/rewards`, `/leaderboard`, `/creator/revenue`): always start "Example data." and only mention synthetic (mock) prices when `PRICE_SOURCE=mock`.
- **Demo compiler**: multi-clause prompts produce one action per clause (one market per clause, all on trigger `t1`, shared exits). The landing sample prompt compiles to NVDA buy $200 (Robinhood) + SOL 2× long $250 (Hyperliquid) gated on Fed-cut odds > 70% (Polymarket, read-only signal) and NVDA < 20-day SMA, stop −8%.
- **Backtest dataCoverage labels** (unchanged, documented): with `PRICE_SOURCE=mainnet-readonly`, a Robinhood instrument with a verified feed is `chainlink_mainnet_readonly` for the part of the window after its first loaded on-chain round (currently 2026-06-22T00:00:43Z for NVDA); before that it is `modeled_eod_tiingo` if Tiingo bars are loaded, otherwise `none` with `gaps: 1`. A Robinhood instrument whose feed is not verified is `none`. Hyperliquid, Polymarket and Solana instruments are always `mock_synthetic` (no real feed). With `PRICE_SOURCE=mock` every instrument is `mock_synthetic`. The web maps `mock_synthetic` → "Simulated".

## 16. M3.3 — price reality vs token-address verification

`Market` now carries two independent groups of flags:

**Price** (derived from `priceSource` only):
- `isMock` — `priceSource` starts with `mock_`.
- `priceIsReal` — `priceSource` is `chainlink_mainnet_readonly` or `jupiter_readonly`.
- `priceVerifiedChainId` — `4663` for Chainlink on Robinhood Chain; `null` otherwise (Solana has no EVM chain id).
- `priceVerifiedNetwork` — `"robinhood-4663"` | `"solana"` | `null`.
- If there is no price (`priceSource: "none"`), both `isMock` and `priceIsReal` are false.

**Token address** (from the verified registry, `config/verified/4663-readonly.json`):
- `addressVerified` — `true` only when the real address/mint is recorded with its official source. Robinhood tokens use item `rh_tokens_4663`, sourced from `https://api.robinhood.com/rhj/assets` (the source of the docs Token Contracts table) and, for WETH, `https://docs.robinhood.com/chain/contracts/`. Each address is checked on-chain (code present, `symbol()` matches). JUP uses item `jupiter_jup` (Jupiter Tokens API v2, `isVerified`). The value is `false` for tokens with only a placeholder and `null` for perps and outcomes.
- `tokenAddress`, `addressChainId` (4663 or null), and `addressSource` give the recorded reference. They are read-only: Quiver does not trade on 4663. Instrument `id`s are still the stable internal placeholder ids.
- Regenerate with `npx tsx src/verify/assets.ts` (HTTP GET plus eth_call only).

**JUP in readonly mode.** `priceSource: "jupiter_readonly"` comes from the Jupiter Price API v3 (keyless, polled every 30s, under the 0.5 req/s limit). That API serves the current price only, so a price older or newer than 180s returns null, bars return null, and backtest coverage is `none` (fail closed, never mock). Indicators on JUP do not evaluate in readonly mode. In mock mode nothing changes.

## 17. M3.4 — polish and security

**API changes**
- `Market.change24hSource`: `"computed"` | `"vendor"` | `null`. `"computed"` means our price now compared with 24h ago. `"vendor"` means the price source supplied the value: in readonly mode JUP's `change24hPct` comes from the Jupiter Price API v3 `priceChange24h` field (checked live 2026-10-27). We do not keep a rolling buffer.
- New error code `payload_too_large` (HTTP 413). Bodies are capped at 64 KB, except `POST /v1/compile` at 6 MB (2 images).
- `POST /v1/backtests`: a range shorter than one full bar at the chosen resolution now returns `validation_failed`.
- Backtest caveats:
  - "No price data for <SYM> in this window…" appears when an instrument's coverage is `none`. Such an instrument no longer counts as a real source.
  - "No trades: the entry conditions were never met in this window." appears when there were no fills.
- Rate limits:
  - `POST /v1/auth/exchange`: 20 per minute per IP.
  - `POST /v1/auth/refresh`: 30 per minute per IP.
  - Guest compile is still 3 per day per IP. X-Forwarded-For is honored only when `TRUST_PROXY=true`; otherwise the socket address is used.
- CORS: `CORS_ORIGINS` must list exact origins. Wildcards are rejected at boot, and unlisted origins get no `Access-Control-Allow-Origin`.
- Logs: error messages are redacted (bearer tokens, JWTs, `sk-` keys, `token=`/`key=` query values, 64-hex strings, URL credentials).

**Determinism.** The mock market is a pure function of instrument and time, so backtests are deterministic. A regression snapshot of the 30-day landing-prompt backtest lives in `test/unit/__snapshots__/m34.test.ts.snap`.

## 18. M3.4.1 — Stock Token fill-time session rule

NYSE sessions are half-open intervals in ET: pre `[04:00, 09:30)`, core `[09:30, 16:00)`, post `[16:00, 20:00)`. On early-close days core is `[09:30, 13:00)` and post is `[13:00, 17:00)`. Holidays and weekends are closed. In backtests (`next_bar` fill model) the session is now checked twice for a Robinhood Stock Token order:
- at the decision time (bar close − 1 ms), as before;
- again at the fill time (the next bar's open).

If the session is closed, or the price is stale, at the fill time, the order is **rejected with `market_closed`**. It is not deferred to the next open, matching the existing rule at placement: a decision is never executed later at a gapped price. A bar that opens exactly at 20:00 ET (or at 17:00 ET on an early-close day) is therefore closed. Live paper runs fill at the decision time, so they were already covered.

## 19. M3.5 — QA gate fixes (Robin, gate on 2c52ff0)

All changes are breaking only where noted (**B**).

- **Backtest range (B).** `POST /backtests` returns 422 `backtest_range_invalid` when `to > now` (`details: { reason: "future", latestTo }`) or `from` is earlier than UTC midnight of now − 365 days (`details: { reason: "before_data", earliestFrom }`).
- **Equity bounds (B).** `startingEquityUsd` (backtests and `paper`) must be a decimal string between `100` and `10000000` inclusive, otherwise 422 `validation_failed`. Exponent forms such as `1e30` are rejected.
- **Sanitized errors.** A backtest that fails for an internal reason reports `error: "Backtest failed. Try again or change the range."`. The detail is logged server-side only. `BacktestError` messages (user-actionable) are unchanged.
- **Per-user caps (new 429).** New code `limit_exceeded` (429):
  - `POST /runs` when the user already has `MAX_ACTIVE_RUNS_PER_USER` (default 5) active runs. Details: `{ kind: "active_runs", limit, active }`.
  - Opening an SSE stream when the user already has `MAX_SSE_PER_USER` (default 10) open. Details: `{ kind: "streams", limit }`, `retryAfter: 5`.
- **Single-use stream tickets (B).** A ticket from `POST /stream-tickets` opens exactly one stream. Reuse returns 401 "Stream ticket already used". Clients must fetch a new ticket for every connect *and reconnect* (native `EventSource` auto-reconnect reuses the URL and will get 401: close it on error, fetch a ticket, reopen with `since`/`Last-Event-ID`).
- **Versions.** `GET /strategies/:id/versions/:v` accepts only a positive integer `v`; anything else (`abc`, `0`, `1.5`) returns 404 `not_found`. It never falls back to the latest version.
- **Unknown routes.** Return 404 `not_found` with or without auth (previously 401).
- **Security headers on every response.** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Cross-Origin-Resource-Policy: same-site`.
- **Refresh cookie.** `Secure` is always set, except in mock mode when the request host is `localhost`/`127.0.0.1`.
- **Dev login (B for local dev).** `DEV_LOGIN_ENABLED` now defaults to `false`. It is refused at boot when `NODE_ENV=production` or on mainnet. The server logs a warning when it is on. A preview with dev login on must sit behind HTTP basic auth.
- **Rate-limit map.** Bounded to 50k buckets, with expired buckets pruned every 60 s.
- **Tooling.** zod ^4.6.7 (`z.toJSONSchema` replaces `zod-to-json-schema`). `npm run lint` uses ESLint 10 + typescript-eslint from an isolated `tools/lint` package; run `npm run lint:install` once.
- **SessionAccount v2 (UNAUDITED).** See `foundry/src/SessionAccount.sol`:
  - `grant(key, expiry, maxSlippageBps, tokens[], perTxCaps[], windowCaps[])`;
  - `executeAsSession(key, target, data, deadline, sig)`, where `digest` includes the per-key nonce and the deadline;
  - `allow(target, selector, kind)` and `setFeed(token, feed, maxAge)`.

## 20. M3.6 — QA gate fixes (Robin, gate on 19e4ba1)
- **Backtest `to` clock skew.** `POST /v1/backtests`: a `to` up to **5 minutes** (300 s, `BACKTEST_MAX_FUTURE_SKEW_MS`) after server now is accepted and **clamped to server now**. A `to` more than 5 minutes ahead still returns 422 `backtest_range_invalid` with `details: { reason: "future", latestTo }`. Range checks (`from < to`, max span per resolution) run on the clamped `to`. Clients should still send `to = now − 2 min` to be safe on slow clocks.
- **Run stop is immediate.** `POST /runs/:id/control {stop}` no longer waits for an in-flight engine tick. The tick is aborted and nothing it produces is logged: `status: stopped` is always the **last** event of a run (no `tick`/“Checked signals” after it). `stop_and_flatten` waits only for the aborted tick to unwind, then emits the flatten fills and then `stopped`.
- **Dev login.** Refused at boot when `NODE_ENV` is `production` in any casing/whitespace (`Production`, ` PRODUCTION `), and allowed only when `QUIVR_MODE` is `mock` or `testnet`.
- **Rate-limit map full.** When the 50k-bucket map is full after pruning expired buckets, a request needing a **new** bucket gets 429 `rate_limited` (`retryAfter` = window). Existing counters are never evicted.
- **CORS.** `Access-Control-Allow-Credentials: true` is sent only when the request `Origin` is on `CORS_ORIGINS` (also on preflight). No header otherwise.
- **SessionAccount (UNAUDITED) changes:**
  - `setFeed(token, feed, maxAge)`: `maxAge` must be 60 s–24 h (else `BadFeed`); `setFeed(token, 0, 0)` clears a feed (swaps then fail closed with `OracleMissing`).
  - Oracle reads also require `answeredInRound >= roundId` and `updatedAt != 0` (else `OracleStale`).
  - `setSequencerFeed(feed, grace)`: optional L2 sequencer uptime feed (Chainlink: 0 = up). Swaps revert `SequencerDown` while down and for `grace` (60 s–24 h) after it comes back. `address(0)` = off (default; L1/local).
  - `slippageCapBps` defaults to **100** (1%); `grant` rejects `maxSlippageBps` above it. `setSlippageCap(bps)` (owner only, 1–1000) is the explicit opt-in to go higher, up to the 10% hard ceiling.
  - Minimum notional per swap = `ceil(windowCap / 64)` (`BelowMinSpend(min)`), and `grant` requires `windowCap <= 64 × perTxCap`. The 64-entry spend log therefore always reaches the window cap before it fills.

## v1.2 (M3.8): sections the web used to mock

All read-only or paper. Schemas: `contracts/src/ext.ts` (v1.2 block). Fixtures: `contracts/fixtures/ext.{landing,settings,run-card,stop-all}.json`.

| Route | Auth | Response | Notes |
|---|---|---|---|
| `GET /v1/public/landing` | none | `LandingRes` | venues, trades (stocks/perps/solana = paper, odds = watch_only), 12 signal tiles (`supported:false` for Earnings, Token premium, Volume: no data source yet), top-3 featured public strategies, 7-day synthetic backtest preview. 60/min/IP, `cache-control: public, max-age=60`. `mock:true` + `notice` must be shown. |
| `GET /v1/settings` | user | `AccountSettingsRes` | limits, usage, session-key defaults ($250/trade, $1000/day), `trading.liveEnabled` is always `false`, `alerts.configured` is always `false`. |
| `POST /v1/runs/stop-all` | user | `StopAllRes` | body `{flatten?:boolean, mode?:"paper"}`; stops only the caller's active runs; idempotent. |
| `GET /v1/runs/:id/card` | owner | `RunCard` | shareable result-card data; numbers equal `GET /runs/:id`. Owner only (404 otherwise). |

Placeholders (need a user decision, no code path yet): alerts delivery provider (`ALERTS_PROVIDER=` email/telegram/webhook), earnings and volume/premium data sources. Autopilot, films, AI refine, pending approvals and partial close stay unsupported; the web must hide or label them "coming soon".

## M3.9 — Session-key prepare rules + wallet signing path (testnet 46630 only)

### `PrepareSessionKeyReq` (POST /v1/session-keys/prepare)
| field | type | rule |
|---|---|---|
| `chainId` | `46630` | 4663 → 403 `mode_not_enabled` |
| `perTxCapUsd`, `dailyCapUsd` | Decimal | `0 < perTx ≤ daily ≤ 64 × perTx` (SessionAccount `MAX_SPENDS_PER_WINDOW`). Over 64× → **422 `session_key_cap_ratio`** (e.g. 10 / 1000) |
| `maxSlippagePct` | number, optional | default `1`; schema `(0, 10]`; whole bps (≤ 2 decimals, else 422 `validation_failed`); above the account cap (`slippageCapBps/100`, default 1, ceiling 10) → **422 `session_key_slippage_above_cap`**. Carried to `policy.maxSlippagePct`, `policy.maxSlippageBps`, `grant.maxSlippageBps` and the typed-data message |
| `expiresInHours` | int, optional | default `defaults.defaultExpiryHours` (24); `> defaults.maxExpiryHours` (168) → **422 `session_key_expiry_too_long`** |
| `expiresInDays` | int, optional, legacy | ×24, same max; sending both → 422 `validation_failed` |
| `tokens` | InstrumentId[] | unchanged |

`SessionKeyDefaults` (+ `GET /v1/session-keys/defaults`) adds `defaultExpiryHours: 24`, `maxExpiryHours: 168`, `maxDailyToPerTradeRatio: 64`. The contract has no on-chain expiry max; 168 h is the platform cap (`SK_DEFAULT_EXPIRY_HOURS` / `SK_MAX_EXPIRY_HOURS`, replacing `SK_*_EXPIRY_DAYS`).

### `PrepareSessionKeyRes` additions
- `policyHash` (bytes32) = `keccak256(abi.encode(chainId, smartAccount, keccak256(targets), key, expiry, maxSlippageBps, tokens, perTxCaps, windowCaps))`.
- `grant` = exact `SessionAccount.grant(key, expiry, maxSlippageBps, tokens, perTxCaps, windowCaps)` args; caps in token base units (USD cap / price, floor; window clamped to 64 × perTx).
- `signatureRequest` = `{ type: "eth_signTypedData_v4", data }`, primaryType `SessionKeyGrant` {sessionKey, smartAccount, policyHash, expiresAt (uint64 as decimal string), maxSlippageBps}, domain `{name:"Quiver Session Key", version:"1", chainId:46630}`.
- `install` = EIP-5792 `wallet_sendCalls` request (`version "2.0.0"`, `chainId "0xb626"`, `from` = owner, `atomicRequired: true`, one call `{to: smartAccount, data: grant calldata, value: "0x0"}`).

### `SubmitSessionKeyReq`
`{ sessionKeyId, signature (65-byte hex), policyHash (required), installTxHash? }`. Server recomputes policyHash from the stored grant; mismatch → **422 `session_key_policy_hash_mismatch`**. Wrong signer → 422 `session_key_policy_violation`. Mock: `active` immediately. Testnet: stays `pending` with `installTx` recorded until the indexer sees `SessionGranted` [indexer confirmation: not built yet]. `SessionKey` adds `policyHash`, `installTx` (nullable).

### `signing_unavailable` (503)
Testnet mode with `ALCHEMY_API_KEY` unset → prepare and submit return 503 `signing_unavailable`. Placeholders (env only, never committed): `ALCHEMY_API_KEY`, `ALCHEMY_GAS_POLICY_ID` (only if `GAS_SPONSORSHIP_ENABLED=true`), `RPC_URL` (optional).

### Wallet flow for Wren (browser; the server never sees a private key)
1. `POST /v1/session-keys/prepare` → show `humanReadable`.
2. `eth_chainId` must be `0xb626`; else `wallet_switchEthereumChain [{chainId:"0xb626"}]`.
3. `eth_signTypedData_v4` params `[ownerAddress, JSON.stringify(res.signatureRequest.data)]` → `signature`.
4. `wallet_sendCalls` params `res.install.params` → `{ id }`; poll `wallet_getCallsStatus [id]` until status 200, take `receipts[0].transactionHash`. Wallets without EIP-5792 (`wallet_getCapabilities` fails): `eth_sendTransaction [{from, to, data, value}]` with the single call.
5. `POST /v1/session-keys/submit { sessionKeyId, signature, policyHash: res.policyHash, installTxHash }`.
6. Poll `GET /v1/session-keys/:id` until `active`. Handle 503 `signing_unavailable` with a "not available yet" state.
Revoke: `DELETE /v1/session-keys/:id`, then `eth_signTypedData_v4` on `onchainRevoke.signatureRequest.data`.
[A] Alchemy MAv2's own session-key install (`wallet_createSession`) replaces step 4 when the real account is wired; SessionAccount.sol is the UNAUDITED local model. Tested: `test/integration/m39.test.ts` drives steps 3–5 through anvil's `eth_signTypedData_v4` / `eth_sendTransaction` on chain 46630.

### Landing
`LandingPreview.author` is now `{ handle, isYou }` (same `Author` as `featured[]`); `isYou` is always `false` on the guest landing.

## M4.0 — Alerts (contracts/src/alerts.ts)
Provider is server-chosen by `ALERTS_PROVIDER` (`webhook` default; `email`/`telegram` are stubs → `providerStatus: "not_configured"`, deliveries end `not_configured`, never retried).
| route | body → response |
|---|---|
| `GET /v1/alerts/settings` | → `AlertSettings {provider, providerStatus, webhookUrl\|null, signingSecretSet}` |
| `PUT /v1/alerts/settings` | `{webhookUrl\|null, rotateSecret?}` → `AlertSettings + signingSecret` (`whsec_<64 hex>` only when created/rotated, else null; show once). Blocked URL → **422 `alert_url_blocked`** |
| `GET /v1/alerts/rules` / `POST` / `DELETE /:id` | `CreateAlertRuleReq {runId\|null (all my runs), events: AlertEventType[1..7], enabled=true}` → 201 `AlertRule`; max 20/user (429 `limit_exceeded`); foreign/unknown run → 404 |
| `GET /v1/alerts/deliveries?limit&cursor` | → `AlertDeliveryList` newest first |
| `POST /v1/alerts/test` | → 202 `AlertDelivery` (one attempt made inline) |

`AlertEventType` = fill, rejected, risk_halt, error, warning, trigger_fired, status. Every run event appended by the engine is matched against the owner's enabled rules (one delivery per matching rule).
**Delivery statuses**: queued → delivered | failed | not_configured | dropped (queue cap 200 queued per user drops the oldest). Retry on network error/timeout(5 s)/408/429/5xx with backoff 10 s, 60 s, 5 min, 30 min; max 5 attempts. 3xx (redirects not followed) and other 4xx are final.
**Webhook request**: `POST <webhookUrl>`, JSON `AlertWebhookPayload {v:1, deliveryId, kind: run_event|test, ruleId, runId, event: RunEvent|null, message, sentAt}`. Headers `X-Quiver-Delivery`, `X-Quiver-Timestamp` (unix s), `X-Quiver-Signature: v1=<hex HMAC-SHA256(signingSecret, "<timestamp>.<rawBody>")>`. Receivers must compare in constant time and reject |now − timestamp| > 300 s.
**SSRF**: https only, ports 443/8443, no credentials, no localhost/.local/.internal; every DNS answer must be public unicast (blocks 0/8, 10/8, 100.64/10, 127/8, 169.254/16 incl. metadata, 172.16/12, 192.168/16, 192.0.0/24, 198.18/15, ≥224, ::, ::1, fc00::/7, fe80::/10, ff00::/8, v4-mapped forms, 64:ff9b::/96). Checked at save time and again at every send; the TCP connection is pinned to the checked address (no rebinding).
Fixtures: `alerts.settings.json`, `alerts.rule.json`, `alerts.deliveries.json`, `alerts.webhook-payload.json`.

## M4.1 — Partial close (paper)
`POST /v1/runs/:id/positions/close` `ClosePositionReq {instrument, pct}` — `0 < pct ≤ 100`, max 2 decimals, percent of the **current** qty. → 200 `ClosePositionRes {runId, orderId, instrument, requestedPct, closedFully, status: filled|rejected|error, fill: RunEvent(fill)|null, rejection: {code,message}|null, remaining: {qty, avgEntry}|null}`.
- Market close through the normal engine path (intent → fill on the run stream, same costs/slippage model, same market-hours rule: a closed stock market gives `status: "rejected"`, code `market_closed`). Average entry is unchanged; realized P&L is pro rata.
- If the remainder would be worth < $1 the whole position is closed (`closedFully: true`).
- Allowed while running, paused or halted (it only reduces risk). Errors: 403 `mode_not_enabled` (non-paper run), 409 `conflict` (run stopped), 404 `not_found` (no open position / not your run), 422 `validation_failed`.
Fixture: `runs.position-close.json`.

## M4.2 Approvals (paper)

`POST /v1/runs` accepts `approvalMode: "auto" | "confirm_each"` (default auto) and `approvalTtlSec` (int 30..3600, default 300). `Run` now carries `approvalMode` and `pendingApprovals`.

In `confirm_each` mode an **opening** order that passes the risk gate does not place: it emits `approval_requested {approvalId, orderId, actionId, instrument, venue, side, notionalUsd, expiresAt}` and waits. Exits, stops, partial close (M4.1) and flatten never wait. At most 20 pending per run; more → `rejected` with code `approval_queue_full`.

- `GET /v1/approvals?status=pending|approved|rejected|expired|canceled&runId=&limit=&cursor=` → `{items: Approval[], nextCursor}`
- `GET /v1/approvals/:id` → `Approval`
- `POST /v1/approvals/:id {decision: "approve"|"reject"}` → `Approval`

`Approval = {id: "apv_…", runId, orderId, actionId, instrument, venue, side, notionalUsd, status, createdAt, expiresAt, resolvedAt|null, result: {status: filled|rejected|error, code|null, message|null}|null}`.

Approve re-runs the full risk gate and pricing at decision time. So an approved proposal can still come back with `result.status = "rejected"` (for example on a daily cap). Every decision emits `approval_resolved {approvalId, orderId, decision: approved|rejected|expired|canceled}`. On approve, `intent`+`fill` with the same orderId follow it.

TTL expiry is checked at each cycle, on list/get and on decide. Stopping a run cancels its pending items.

Errors:
- 404 `not_found`: the approval doesn't exist or isn't yours.
- 409 `conflict`: the approval is already resolved or expired, or you tried to approve on a paused or halted run.
- 422: a bad decision or TTL value.

Every decision is audited (`approval.approve|reject`). Fixtures: `approvals.pending.json`, `approvals.approved.json`.

## M4.3 Portfolio views (read-only, across all of the caller's runs in one mode)

The existing `GET /v1/portfolio` (open positions on active runs) and `GET /v1/fills` (trade history) are unchanged. New endpoints:

- `GET /v1/portfolio/runs?mode=paper&status=all|active|stopped` returns `PortfolioRuns {mode, items: PortfolioRunRow[], totals, asOf}`. Rows are sorted by `startedAt`; ties keep creation order.
  - `PortfolioRunRow = {runId, strategyId, status, startedAt, stoppedAt|null, startingEquityUsd, equityUsd, pnlUsd, pnlPct, realizedPnlUsd, unrealizedPnlUsd, feesUsd, openPositions, fills}`.
  - Stopped runs are marked at `stoppedAt`.
  - `totals` has the same P&L fields summed. `pnlPct` = totals pnl / totals starting equity.
- `GET /v1/portfolio/allocation?mode=paper&by=venue|asset_class|instrument` returns `PortfolioAllocation {mode, by, grossExposureUsd, netExposureUsd, cashUsd, items: [{key, label, longUsd, shortUsd, grossUsd, netUsd, weightPct, positions}], asOf}`.
  - Covers open positions on active runs only, marked at now. Shorts are perp qty < 0.
  - `weightPct = gross / grossExposure × 100` (2 dp). Items are sorted by grossUsd desc, then key.
- `GET /v1/portfolio/history?mode=paper&points=2..500 (200)` returns `PortfolioHistory {mode, points: [{ts, equityUsd, pnlUsd, activeRuns}], asOf}`.
  - Built over the union of all run equity timestamps. A run counts from its first point and keeps its last-known equity (stopped runs stay at their final equity).
  - `pnlUsd` is measured against the summed starting equity of the runs counted so far. Points are thinned evenly by index.

Errors: 422 for a bad `mode`, `status`, `by` or `points` value. A user who has no runs gets empty items and points (not 404). Fixtures: `portfolio.runs.json`, `portfolio.allocation.json`, `portfolio.history.json`.

## M4.4 Run replay ("films")

`GET /v1/runs/:id/replay?frameMs=1000..86400000 (60000)&maxFrames=1..2000 (500)&from=ISO&to=ISO` returns `Replay`.

- `Replay = {runId, frameMs, startTs, endTs, totalFrames, truncated, frames: ReplayFrame[], chapters: [{frame, seq, type, summary}], digest: "sha256:<hex>"}`.
- `ReplayFrame = {i, ts, lastSeq, equityUsd|null, positions: [{instrument, qty, avgEntry}] (sorted by instrument), events: [{seq, ts, type, summary}], counts: {fills, rejected, halts}}`.
- Frame `i` covers `[startTs + i·frameMs, startTs + (i+1)·frameMs)`.
- **Sources:** built only from the stored run events (positions from `fill.position`) plus the stored equity curve (last point before the frame end). It works for stopped runs too.
- **Window:** with `from`, earlier events are folded in first, so frame 0 starts from the true state. `maxFrames` cuts the tail and sets `truncated: true`.
- **Frame events:** only key types are listed (fill, rejected, error, status, risk_halt, trigger_fired, approval_requested, approval_resolved, warning). Ticks are counted via `lastSeq` only.
- **Chapters:** status changes, risk halts and the first fill.
- **Deterministic:** the same run state and the same query give byte-identical output and `digest` (sha256 of the JSON without the digest). Clients can cache on it.

Errors: 404 if the run isn't yours, 422 for bad query values or `to < from` (`validation_failed`). Fixture: `runs.replay.json`.

## M4.5 Autopilot (paper only)

Autopilot rotates through the caller's own strategies on a schedule, running one **paper** run at a time. There is no testnet or live autopilot. It uses no keys or funds and signs nothing. Runs start through the same guarded path as `POST /v1/runs` (validation, the per-user active-run cap, one run per strategy) and are audited (`autopilot.start_run`).

- `GET /v1/autopilot` returns `Autopilot`.
  - Shape: `{configured, enabled, killed, mode: "paper", strategyIds, rotateEveryMin, startingEquityUsd, guardrails: {maxDrawdownPct, maxDailyLossUsd, maxRotationsPerDay}, state: {currentRunId|null, currentStrategyId|null, nextRotationAt|null, rotationsToday, dayPnlUsd, platformKillSwitch, lastDecision|null}}`.
  - It returns `configured: false` until the first PUT.
- `PUT /v1/autopilot` takes `{enabled, mode?: "paper", strategyIds: StrategyId[1..10] (unique, owned, not archived), rotateEveryMin: 15..1440 (60), startingEquityUsd (10000), guardrails?: {maxDrawdownPct: 1..50 (10), maxDailyLossUsd: >0..100000 (500), maxRotationsPerDay: 1..48 (12)}, acknowledgeKill?: false}` and returns `Autopilot`.
  - Enabling starts the first strategy straight away.
  - `enabled: false` stops and flattens the current run.
- `POST /v1/autopilot/kill` stops and flattens the current run, then sets `enabled: false, killed: true`. Re-enabling needs `acknowledgeKill: true`.
- `GET /v1/autopilot/log?limit=&cursor=` returns `{items: AutopilotDecision[], nextCursor}`, newest first.
  - `AutopilotDecision = {at, action: started|rotated|skipped|guardrail_stop|killed|disabled|start_failed, fromRunId|null, toRunId|null, strategyId|null, reason}`. The last 500 are kept.

**Scheduler:** runs every 30 s (`AUTOPILOT_STEP_SEC`), once per user.
- **Rotation:** when `rotateEveryMin` has passed, it stops and flattens the current run and starts the next strategy round-robin. Strategies that refuse to start are logged `start_failed` and skipped. If none can start, the decision is `disabled`. With a single strategy, nothing rotates.
- **Rotation cap:** `rotationsToday ≥ maxRotationsPerDay` (UTC day) logs `skipped` once, and the current run keeps going.
- **Drawdown guardrail:** current equity at or below the run's peak by `maxDrawdownPct` gives `guardrail_stop` (flatten, disable).
- **Daily loss guardrail:** a summed P&L of today's autopilot runs ≤ −`maxDailyLossUsd` gives `guardrail_stop` (flatten, disable).
- **Platform kill switch:** while it is on, no starts or rotations happen. The platform already halts the runs.
- **Run stopped elsewhere:** if the current run was stopped outside autopilot, the next strategy is started.

Errors:
- 403 `mode_not_enabled`: any mode other than paper.
- 404 `not_found`: a strategy that isn't yours or is archived, or kill when nothing is configured.
- 409 `conflict`: re-enabling after a kill without `acknowledgeKill`.
- 422: validation failures.

State is in memory only, so a restart loses it. Fixtures: `autopilot.state.json`, `autopilot.log.json`.

## M4.2.1 — gate fixes (Robin, 9c8f10e)

**Webhook delivery (alerts)**
- Transport pins the connection to the SSRF-checked address and now supports Node ≥20 `lookup({all:true})`, so webhooks actually deliver. This is covered by a real local TLS test.
- Each attempt has a **total deadline of 10 s** covering connect, TLS, send and response. When it runs out, the socket is destroyed. A response body over **64 KB** aborts the attempt. Both cases count as retryable errors (`deadline exceeded` / `response too large`).
- Deliveries are grouped by destination:
  - Within one destination they run one at a time.
  - Different destinations run in parallel, with at most 8 attempts in flight.
  - A slow receiver only delays its own alerts.
- `X-Quiver-Delivery` (= `payload.deliveryId`) stays the same across all retries of one alert. **Receivers must dedupe on it**, and still reject a timestamp skew over 300 s.
- SSRF is now an allowlist:
  - IPv4 must be outside every IANA special-purpose block, including TEST-NETs 192.0.2/24, 198.51.100/24 and 203.0.113/24, as well as 240/4.
  - IPv6 must be global unicast `2000::/3`. These are excluded: `2001::/23` (Teredo), `2001:db8::/32`, `3fff::/20` and `2002::/16` (6to4).
  - Every other IPv6 address is refused: v4-mapped or compat in any notation, NAT64 `64:ff9b::/96`, `fec0::/10`, `100::/64`, ULA, link-local and multicast.
- Hostnames are lower-cased and trailing dots are stripped before the name check (`LOCALHOST.` → refused).

**Approvals**
- `POST /v1/approvals/:id {decision:"approve"}` checks the run state again on the run's serialized chain. If the run became paused, halted or stopped after the route check, the response is `409 conflict` ("Run is <status>; resume it before approving."). The approval stays **pending** (it is not consumed), so it can be approved after resume as long as it has not expired. `reject` is always allowed.
- `pause` takes effect immediately instead of waiting behind queued work.
- The risk gate also refuses non-reducing orders on halted or paused runs, with new reject codes `run_halted` and `run_paused`. Reducing orders (exits, partial close) are still allowed.
- Each run keeps at most **200 resolved** approvals; the oldest resolved ones are dropped first. Pending approvals are never pruned.

**Misc**
- `503 signing_unavailable` message: "Wallet signing is temporarily unavailable on this server. Try again later." It no longer names the server config.
- Dev persistence: a paused run comes back **paused** after a dev restart and does not trade until it is resumed.

## M4.5.1 Autopilot and alerts hardening (gate 5d5c80f)

- **Concurrency:** each user has a mutex around pass, save, disable and kill. Kill and disable flip `enabled`/`killed` and bump an internal epoch *synchronously*, before they take the lock. Then, after every await, a pass re-checks enabled, not killed, same epoch and the platform kill switch. If a run started while the state changed, it is stopped right away. `step(uid)` and `stepAll()` are single-flight, so the 30 s timer never overlaps a pass and a rotation is counted once.
- **Kill** stops every run autopilot started (it tracks up to 200 run ids per user). It never touches runs the user started by hand.
- **Paused or halted current run:** the rotation is **skipped**, not replaced. The log gets `{action:"skipped", reason:"current run is paused|halted; rotation skipped until it is resumed"}`, deduped.
- **External stop:** if the tracked run is stopped outside autopilot, autopilot **disables itself** (`{action:"disabled", reason:"run was stopped outside autopilot"}`). There are no restarts, so the rotation cap cannot be bypassed.
- **`approvalMode: "auto"|"confirm_each"` (default auto)** is a new field in `PutAutopilotReq` and `Autopilot`. It is passed to every run autopilot starts. With confirm_each, orders wait in `/v1/approvals`.
- **Persistence (dev store):** settings and state persist with the store (map `autopilot`). On restore, `reconcile()` keeps the tracked run under the same guardrails. It stops any other live autopilot-owned run, and it stops everything when autopilot is disabled or killed.
- **Alerts:** at most 8 attempts are in flight across the whole service, using a shared semaphore that spans rounds. `POST /v1/alerts/test` makes one attempt for its own delivery only and does not wait on the queue. The webhook DNS lookup has a 3 s budget; a timeout is a retryable failure.

## M4.5.2 Landing and ops follow-ups (gate 5114786)

- `GET /v1/public/landing` `notice` now names the configured `PRICE_SOURCE`. Mock says "synthetic (mock) prices". Mainnet-readonly says "Chainlink mainnet read-only prices for Robinhood Stock Tokens and ETH, synthetic prices for other venues", the same wording as the example notices. `preview.synthetic` is unchanged.
- A failed or empty `preview` (`null`) is cached for 60 s and then retried. A good preview is still cached per UTC hour.
- Ops: `scripts/ops/stop-api.cmd [PORT] [TASK]` uses cmd and curl.exe only. It reads the port and task from args, then from env `QUIVER_PORT`/`QUIVER_TASK`, then falls back to the defaults 8987/QuiverApi. The `.ps1` defaults were fixed to 8987/QuiverApi. See OPS.md.

## M4.6 — Wren's gaps

- **Approve 409** (`POST /v1/approvals/:id`, code `conflict`; message unchanged): `error.details = { runStatus: "paused"|"halted"|"stopped"|"aborted", haltReason?: string }`. `haltReason` = `"<rule>: <message>"` from the latest risk halt. Schema `ApproveConflictDetails`. Fixture `approvals.conflict.json`.
- **Approval** adds `strategyId`, `strategyName`, `actionTitle` (e.g. "Buy $250 of ETH", "Long 10% of equity in SOL at 3x", "Close SOL (exit rule)").
- **Autopilot**: `state.currentStrategyName`; `state.lastDecision` and `GET /v1/autopilot/log` items add `strategyName`, `fromStrategyName`, `toStrategyName` (nullable; names resolved at read time).
- **Positions**: `GET /v1/positions?mode=paper|testnet&runId=` (default paper; 404 for a runId you don't own; 422 bad mode) and `GET /v1/runs/:id/positions` (404 if not owned). `PositionsRes { mode, items: OpenPosition[], asOf }`, `OpenPosition { instrument, symbol, venue, runId, strategyId, strategyName, qty (absolute), side: long|short, avgEntry, markPrice|null, unrealizedPnlUsd|null, notionalUsd|null, openedAt }`. Active runs only, sorted by openedAt. Fixture `positions.paper.json`.
- **Config (M3.9 audit)**: boot rejects `SK_DEFAULT_EXPIRY_HOURS > SK_MAX_EXPIRY_HOURS` and `SK_DEFAULT_DAILY_USD` outside `[SK_DEFAULT_PER_TX_USD, 64×SK_DEFAULT_PER_TX_USD]`.

## M4.7 — trigger snapshot + approval_requested names

- **`TriggerStateItem`** `{ triggerId, state: ready|holding|cooldown|done|blocked, conditionTrue: bool|null, heldForSec, cooldownUntil|null, fires }`. This is the same shape as `tick.triggers`.
- **SSE connect/resume** (`/v1/runs/:id/events/stream`, with or without Last-Event-ID/`since`): the snapshot frames (no `id:`) are `status`, then a full `tick` (if cycle > 0), then **`triggers_snapshot`** `{ ...Base, type: "triggers_snapshot", cycle, triggers: TriggerStateItem[] }`, then the log frames after the cursor. `triggers_snapshot` is never stored in the run log, so it's absent from `/events` polling and replay.
- **`GET /v1/runs/:id`** adds `triggerStates: TriggerStateItem[]`: live state, `[]` once stopped.
- **`approval_requested` event** adds `strategyName`, `actionTitle` (same title as the Approval object).
- Fixtures: `runs.get.json`, `events.connect-snapshot.json`, `events.approval-requested.json`.

## M4.8: public leaderboard and share cards (contracts/src/public.ts)

- **`GET /v1/public/leaderboard?period=7d|30d|all&limit=1..50`** (default 30d/20). No auth. Rate limit is 30/min per IP; results are cached server-side for 60 s per period and sent with `cache-control: public, max-age=60`. A bad period returns 422.
  - `PublicLeaderboardRes { period, minTrades, items, asOf, synthetic, notice }`
  - `PublicLeaderboardItem { rank, handle, strategyName, publicStrategyId, venues, basis: paper|backtest, returnPct, maxDrawdownPct|null, winRatePct|null, trades, spark (equity % of start, 100 = flat) }`
  - Only opt-in public strategies are included (seeds plus `POST /strategies/:id/publish {public:true}`). The basis is the owner's latest paper run of that strategy started in the period with `trades ≥ minTrades`, otherwise a backtest over the period. Rows below `minTrades` (`LEADERBOARD_MIN_TRADES`, default 3) are dropped. Ranking is by returnPct desc, then trades.
  - `handle` is `@label`, or `@trader_<sha8>` when the label isn't a plain handle (email/phone-like).
  - No user ids, run ids, wallets or USD values. `publicStrategyId` is the already-public id of `/public/strategies/:id`.
- **`POST /v1/runs/:id/card/share`** (owner only; 404 otherwise; paper/testnet only) returns 201 `CardShareRes { token: "crd_<32 base64url>", path: "/v1/public/cards/<token>", createdAt }`. It is idempotent while a token is active.
- **`DELETE /v1/runs/:id/card/share`** (owner only) returns `CardRevokeRes { revoked }`. A later share mints a new token. Both are audited (`run.card.share`, `run.card.revoke`).
- **`GET /v1/public/cards/:token`**: no auth. Rate limit is 60/min per IP, sent with `cache-control: public, max-age=30` and `x-robots-tag: noindex`. An unknown or revoked token returns 404.
  - `PublicCard { strategyName, handle, mode, status, venues, startedAt, stoppedAt, durationSec, returnPct, maxDrawdownPct, trades, triggerFires, spark (% of start), synthetic, sharedAt, asOf, disclaimer }`
  - Percentages and counts only; no ids or USD values.
- OG image: not built yet.
- Fixtures: `public.leaderboard.json`, `public.card.json`, `runs.card-share.json` (token masked).

## M4.9 — Instruct a running paper strategy (contracts/src/instruct.ts)

`POST /v1/runs/:id/instruct` `{text}` (3..500 chars) → **201 InstructProposal**. Nothing changes yet.
`POST /v1/runs/:id/instruct/:proposalId/apply` → **200 InstructApplyRes** `{proposal, strategyVersion, runId}`.

Both are owner only (any other caller gets 404) and **paper only** (`mode_not_enabled` 403 otherwise). A stopped run returns `conflict` 409 `{runStatus}`.
Rate limits: propose 10/min and 100/day per user; apply 10/min. Audit actions are `run.instruct.propose` (meta: proposalId, op names, compiler) and `run.instruct.apply` (meta: proposalId, version).

**InstructProposal:** `id (ins_…), runId, strategyId, baseVersion, text, ops[], changes[{path, before, after, summary}], issues[] (ValidationIssue), ok, compiler ai|demo, notice|null, status proposed|applied|expired|superseded, createdAt, expiresAt (+15 min), appliedAt|null, appliedVersion|null`.

**InstructOp** is a closed, strict union. No op has a free-text field, every op references existing ids, and every number is bounded:
- `set_size {actionId, size{unit usd|pct_equity, value Decimal}}`
- `set_leverage {actionId, leverage 1..10}`
- `set_exits {actionId, takeProfitPct?, stopLossPct?, trailingStopPct?, timeExitHours?}` (at least one exit)
- `pause_rule {triggerId}`: removes the trigger and any actions only it fires, as a new version
- `set_cooldown {triggerId, minutes 0..43200}`
- `set_risk {field maxPositionPct|maxTotalExposurePct|maxDailyLossPct|maxOrdersPerDay, value 1..500}`

**Compiler.** With `OPENROUTER_API_KEY` set, OpenRouter returns strict JSON-schema output (`InstructDiff {ops 1..8}`). The model receives only an id/symbol/value outline of the strategy (no thesis or names), and the user text is passed as JSON data. Output that fails the schema or references an unknown id is discarded, and the demo keyword parser runs instead (`notice` explains). With no key, the demo parser always runs. Text with no recognisable edit, or with out-of-range values, returns `unsupported_prompt` 422 `{suggestions}`.

**Apply** re-runs `validateStrategy` plus the geo note, exactly as `POST /strategies` does, then the run-start gate. Errors return `strategy_invalid` 422. If the strategy changed after the proposal was made, the proposal becomes `superseded` (409 `details.status`); an expired or already-applied proposal also returns 409. On success it pushes version `baseVersion+1`, hot-swaps the live paper run onto it (trigger state is kept for unchanged ids, `run.strategyVersion` is updated), and emits a `warning` event with code `strategy_updated` listing the change summaries.

Fixtures: `runs.instruct.json`, `runs.instruct-apply.json` (proposal id masked).

## M4.9.1 — friendly errors, LLM caps, kill hardening (gate aaa21a4)
- **Validation errors (all endpoints):** `422 { error: { code: "validation_failed" | "strategy_invalid", message, details: ValidationIssue[] } }`. Each issue is `{ path, code, message }` (validate also adds `severity`). Raw zod text never appears. Issues are de-duplicated by code and message (max 20).
  - Codes: `strategy_needs_rule`, `strategy_needs_action`, `too_few`, `too_many`, `too_short`, `too_long`, `out_of_range`, `missing_field`, `invalid_value`, `invalid_format`, `unknown_field`, plus the existing semantic codes. `"schema"` stays in the enum for old clients but is no longer emitted for zod issues.
  - Zero rules gives exactly one issue: `{ code: "strategy_needs_rule", message: "A strategy needs at least one active rule" }`. The `strategy_needs_action` that would follow from it is dropped.
- **`POST /v1/runs/:id/instruct`:** a change that leaves the strategy invalid is refused with `422 strategy_invalid` and nothing is stored. The message is "A strategy needs at least one active rule" when that is the reason, otherwise "This change would make the strategy invalid." `details` holds the issues. A stored proposal therefore always has `ok: true`.
- **LLM caps:**
  - Instruct counts toward the same per-user daily quota as compile (`LLM_USER_DAILY_COMPILES`). Over the quota returns `429 compile_quota_exceeded` with `Retry-After`.
  - Each LLM call reserves `max(LLM_EST_CALL_USD (default 0.05), largest call today)` before it runs, then settles to the actual cost. Parallel calls cannot overshoot `LLM_DAILY_BUDGET_USD` by more than estimate minus actual. When a call is refused, compile returns `compile_cost_cap` on the first attempt (demo fallback on repairs), and instruct falls back to demo (`fallbackReason: "budget"`).
- **Public handles:** email-like or otherwise unsafe names show as `@trader_<8 hex>` = HMAC-SHA256(server secret, name). Without the secret the alias cannot be matched to a known email. It changes if the JWT secret rotates.
- **`GET /v1/public/cards/:token`:** `cache-control: public, max-age=5`. A revoke takes effect within 5 s.
- **`POST /v1/runs/:id/control {action:"stop_and_flatten"}`:** waits at most 5 s for the in-flight tick and the flatten. On timeout the run is still stopped and gets a `warning` event with code `flatten_timeout`. A plain `stop` never waits.
- **`POST /v1/autopilot/kill`** returns `AutopilotKillRes` = `Autopilot` + `kill: { stopped, failed: [{ runId, reason }] }`. It is `200` when every run stopped and `207` when some failed. A failed stop is logged and never blocks the others, and the user is still marked killed.
- **Autopilot timer:** users are processed in parallel (cap 8) with a 20 s timeout per user, so one stuck user never stalls the others.
- **Ops:** `scripts/ops/stop-api.cmd [PORT] [TASK] [TOKENFILE]` reads the token from a file (arg 3, else `QUIVER_OPS_TOKEN_FILE`, else `C:\quiver\secrets\ops_token`). It sends the header through a temporary curl `--config` file, so the token is never on a command line. It waits with `ping -n 2 127.0.0.1` so it works over WinRM.

## M4.9.2 — LLM budget, instruct refund, late flatten (gate 485da53)
- **LLM reservation:**
  - Each call reserves `max(LLM_EST_CALL_USD, priced worst case, largest call today)` before it runs.
  - `LLM_EST_CALL_USD` now defaults to 0.50; a lower value is raised to 0.50, so an old .env never breaks boot.
  - Priced worst case = `(LLM_MAX_INPUT_TOKENS × LLM_PRICE_IN_PER_MTOK + LLM_MAX_OUTPUT_TOKENS × LLM_PRICE_OUT_PER_MTOK) / 1e6`. It applies only when both prices are set.
  - `max_tokens = LLM_MAX_OUTPUT_TOKENS` (default 4000) is sent on every call.
  - A reservation is refused when spent + reserved + estimate would pass `LLM_DAILY_BUDGET_USD`, so reserved money never exceeds what is left.
  - At most `LLM_MAX_INFLIGHT` (default 4) calls run at once. Overshoot is at most in-flight calls × (actual − estimate), and zero when the prices are set.
- **When the cap is full:**
  - `/compile` falls back to the demo compiler with the notice "The AI compiler is busy, so this is a demo compile…" (HTTP 200, `compiler: "demo"`).
  - Instruct falls back to demo.
  - Hitting the budget cap is unchanged (`compile_cost_cap`).
- **Instruct quota:** a 422 (`unsupported_prompt` or `strategy_invalid`) refunds its compile. Only proposals that are stored count toward `LLM_USER_DAILY_COMPILES`. The 10/min and 100/day instruct rate limits still apply.
- **Late fills:** once a run is `stopped`, its paper account is frozen. A fill that resolves later (a late flatten after the 5 s cap, or an aborted tick) is blocked and counted, never applied. The `flatten_timeout` warning says so. Positions stay at their last mark.

## M5.0 — read-only testnet adapter (46630) + AA on anvil
Contracts: `contracts/src/chain.ts`. Both routes need auth. Reads only: the adapter's transport allowlists
`eth_chainId/blockNumber/getCode/getBalance/call/getBlockByNumber`; anything else (send, sign, wallet_*, anvil_*) throws
before any I/O. The node's chain id is pinned (46630); a mismatch fails closed.
- `GET /v1/chain/testnet/status` → `ChainStatusRes` `{chainId, network, readOnly:true, reachable, chainIdMatches, blockNumber, tradable:false, verification:[{id,status}] (V1–V11 from config/verified/46630.json), reasons[], checkedAt}`. Cached 10 s. With `CHAIN_READS_ENABLED=false` (default) it answers 200 with `reachable:false` and the reason.
- `GET /v1/chain/testnet/accounts/:address?sessionKey=0x…&tokens=0x…,0x…` (≤ 8 tokens) → `AccountReadRes`: native balance and code at one block; if code exists, SessionAccount `owner`, `slippageCapBps`, `sequencerFeed/Grace`, and for `sessionKey` the session (`exists/revoked/expiry/maxSlippageBps/nonce`) with per-token `perTxCap/windowCap/spentInWindow`. `codeCheck`: `match` | `mismatch` (account null — wrong hash or not a SessionAccount) | `unchecked` (no `TESTNET_SESSION_ACCOUNT_CODEHASH`) | `no_code`. 422 bad address; 503 `venue_unavailable` when reads are off, the RPC is down, or the chain id is wrong.
- Env: `CHAIN_READS_ENABLED`, `TESTNET_RPC_URL`, `CHAIN_READ_TIMEOUT_MS` (4000), `TESTNET_SESSION_ACCOUNT_CODEHASH`. `TESTNET_DEPLOYER_PRIVATE_KEY` is a commented placeholder only; the API never reads it.

## M5.1 — market detail page
Contracts: `contracts/src/market.ts`. Auth required. Same price sources and labels as `/markets`; mock mode is labelled synthetic.
- `GET /v1/markets/:instrumentId/history?tf=15m|1h|4h|1d&range=1d|7d|30d|90d|1y` (defaults 1h, 7d) → `MarketHistoryRes`
  `{instrumentId, tf, range, from, to, bars:[{t,o,h,l,c}] (oldest first, decimal strings, never after server now), stats:{open,high,low,last,changePct,rangePct,volatilityPct,bars}, synthetic, coverage:[{source,from,to,gaps,synthetic,modeled?}], notice|null}`.
  Max 500 bars: range/tf > 500 (e.g. 15m × 30d) → 422 `validation_failed` with `details.maxBars`. Unknown id → 404.
- `GET /v1/markets/:instrumentId/detail` → `MarketDetailRes` `{market: Market (same as /markets/:id), returns:{"1d","7d","30d"} (% strings|null), high30d, low30d, volatility30dPct, synthetic, notice}`.

## M5.2 — Privy sign-in + wallet-link scaffold
Contracts: `contracts/src/auth.ts`; new error codes `auth_unavailable` (503) and `wallet_link_invalid` (422).
- `GET /v1/auth/config` (public) → `{privy:{enabled, appId|null}, devLogin, walletLink:{enabled:true, method:"personal_sign", maxWallets:5}}`. Web shows the Privy button only when `privy.enabled`.
- `POST /v1/auth/exchange {provider:"privy", idToken}` (same shapes as before → `AuthExchangeRes`):
  - `dev:<label>` with dev login on → dev user (unchanged). `dev:` with dev login off → 401.
  - Otherwise Privy is required: `PRIVY_APP_ID` + `PRIVY_APP_SECRET` unset → **503 `auth_unavailable`** (fail closed).
  - Verification (server-side, node:crypto): ES256 only, key by `kid` from JWKS (`https://auth.privy.io/api/v1/apps/<appId>/jwks.json`, cached 10 min) or `PRIVY_VERIFICATION_KEY`; `iss=privy.io`, `aud=appId`, `exp/nbf/iat` ±60 s, `sub` = `did:privy:…`. Any failure → 401; JWKS unreachable → 503.
  - User is keyed by Privy `sub`; first Ethereum wallet in `linked_accounts` becomes the primary wallet and a linked wallet.
- Wallet link (server verifies an EIP-191 signature; never signs):
  - `POST /v1/wallets/link/challenge {address}` → `{nonce, message, expiresAt}` (5 min, one live challenge per user, 10/min).
  - Client: `personal_sign(message)` in the user's wallet.
  - `POST /v1/wallets/link/verify {nonce, signature}` → `LinkedWalletsRes {items:[{address, linkedAt, primary}]}`. Nonce is single-use (burned even on a bad signature); wrong signer / expired / other user's nonce → 422 `wallet_link_invalid`; > 5 wallets → 429 `limit_exceeded`. EOA signatures only for now (ERC-1271 smart-account signatures need an RPC read; later).
  - `GET /v1/me/wallets` → `LinkedWalletsRes`; `DELETE /v1/me/wallets/:address` → `LinkedWalletsRes` (404 if not linked).

## M5.3 Write off a stuck position (paper)

Paper runs only (other modes: 422 `mode_not_enabled`). For positions that cannot be closed. Recovery is zero: a spot position loses its cost basis, and a perp loses its posted margin (|qty|·avgEntry/leverage). The loss is booked as realized P&L.

- `GET /v1/runs/:id/positions/write-off?instrument=<id>` returns `{runId, instrument, eligible, reasons: ("no_price"|"price_stale"|"venue_down"|"close_rejected")[], message, position: {qty, avgEntry, kind}|null, basis:"zero_recovery", lossUsd|null}`.
  - The position is eligible when at least one reason applies.
  - A normal session close (staleReason `market_closed`) does **not** count as stuck.
  - `close_rejected` means a `/positions/close` on this run+instrument failed in the last 24 h.
- `POST /v1/runs/:id/positions/write-off {instrument, confirm:true}` returns `{runId, instrument, writtenOff:true, reasons, qty, avgEntry, lossUsd, basis:"zero_recovery", at}`.
  - Errors: 409 `conflict` if the position is still closable; 404 for no position or a run that is not yours; 422 if `confirm` is missing; limited to 10/min per user.
  - Side effects: the position and its pending orders are removed. A `warning` event with code `position_written_off` goes on the run log, and an audit entry `run.write_off` is recorded.

## M5.4 Autopilot plan (paper, streamed)

The planner scores your own strategies with a backtest over a recent window, using 1h bars. The scoring is deterministic (`source:"deterministic"`, with no LLM). It proposes a `PutAutopilotReq` body and **never applies it**: the proposal always has `enabled:false`, and the client shows it and then calls `PUT /v1/autopilot` once the user accepts.

- Request: `AutopilotPlanReq {strategyIds?: StrategyId[1..10] (defaults to your newest 10), goal?: "balanced"|"return"|"low_risk" (default balanced), lookbackDays?: 7|30 (default 7), startingEquityUsd?}`.
- `POST /v1/autopilot/plan/stream` returns an SSE stream (`text/event-stream`). Consume it with fetch, not EventSource, because it is a POST. The frames are:
  - `status` `{stage:"loading"|"scoring"|"ranking", message}`
  - `candidate` `{strategyId, name, index, total, ok, error|null, metrics:{returnPct, maxDrawdownPct, sharpe|null, trades}|null, score|null}`
  - `plan`: an AutopilotPlan, which ends the stream.
  - `error` `{code, message}`, which also ends the stream.
- `POST /v1/autopilot/plan` takes the same request and returns the whole `AutopilotPlan` in one response: `{goal, lookbackDays, ranked[≤5], excluded[], proposal: PutAutopilotReq|null, rationale: string[], source, synthetic, notice}`.
  - A strategy is ranked when it ran without error, made at least 1 trade and stayed at or under 25% max drawdown. Ties break on strategyId.
  - Guardrails are derived from the plan: max drawdown is 1.5× the worst ranked drawdown, clamped to 5–50%. Max daily loss is 5% of equity, or 2% for low_risk.
  - Rotation interval is 120 min for balanced, 60 for return and 240 for low_risk.
- Errors are checked before the stream opens:
  - 404 for a strategy that is not yours.
  - 422 for a bad body or an account with no strategies.
  - 429 above 6 per minute per user, or while a plan is already being built.
  - If the client disconnects, the backtest is canceled.

## M5.5 Profiles, follow, paper copy-trading

A handle is the same `@…` string that `/traders` and `author.handle` show. URL-encode it in paths.

**Profiles**
- `GET /v1/profiles/:handle` returns a Profile: `{handle, displayName|null, bio|null, isYou, isFollowing, demo, followers, following, strategies:[{id,name,venues,forks,paperReturn30dPct|null,publishedAt}], bestPaperReturn30dPct|null}`.
  - An unknown handle gives 404.
  - `demo:true` marks seed authors.
- `GET /v1/me/profile` returns your own Profile.
- `PUT /v1/me/profile {displayName?: ≤40|null, bio?: ≤280|null}` returns the updated Profile. Control characters are stripped, and an empty body gives 422.

**Follow**
- `POST /v1/profiles/:handle/follow` and `DELETE /v1/profiles/:handle/follow` return `{handle, following, followers}`.
  - Following is idempotent.
  - Following yourself gives 422.
  - You can follow up to 500 traders (`limit_exceeded` 429 beyond that), and make 60 follow calls per minute.
- `GET /v1/me/following` returns `{items:[{handle, displayName|null, strategies}]}`.

**Copy-trading (paper only)**
- `POST /v1/copy {publicStrategyId, mode?:"paper", startingEquityUsd?, approvalMode?:"auto"|"confirm_each"}` returns 201 with a CopyView. It saves a private copy of the strategy and starts a paper run of it.
  - Errors:
    - 403 `mode_not_enabled` for any mode other than paper.
    - 403 `forbidden` if you don't follow the author (details.handle names them).
    - 409 if you already copy this strategy.
    - 422 for your own strategy.
  - All the usual run guards apply (active-run cap, validation).
- CopyView: `{strategyId, publicStrategyId, sourceHandle, sourceName, sourceVersion, latestSourceVersion|null, behind, mode:"paper", runId|null, runStatus|null, copiedAt, syncedAt}`.
  - `latestSourceVersion` is null once the source is unpublished.
- `GET /v1/copy` returns `{items: CopyView[], notice}`.
- `POST /v1/copy/:strategyId/sync` returns a CopyView.
  - If the source has a newer version, it is appended to your copy and hot-swapped into the live paper run, which logs a `strategy_updated` warning.
  - If the source is unpublished you get 409; if the copy is not yours, 404.
- Stopping a copy uses the normal `/v1/runs/:id/control`.

## M5.6 Compile from a chart screenshot (vision)

`POST /v1/compile/image` (signed in; guests get 401). Body ≤ 6 MB JSON:
`{ mimeType: "image/png"|"image/jpeg"|"image/webp", imageBase64: string (a data: URL prefix is OK), note?: string ≤500 }`

Response: the same NDJSON stream as `POST /v1/compile` (`progress` / `partial` / `result` / `error` lines). Each result is a draft, so save it via the usual strategy routes.

Checks run before any AI call or quota charge:
- 3/min per user, counting rejected uploads → 429 `rate_limited`.
- Key unset (placeholder) → 503 `vision_unavailable`. The UI should fall back to the text compile.
- Decoded size > 2 MB → 413 `payload_too_large`, `details.reason="too_large"`.
- 422 `image_invalid` with `details.reason` one of `unsupported_type | type_mismatch | bad_encoding | corrupt | bad_dimensions`. `details` also includes `{maxBytes, minPx: 64, maxPx: 4096}`. The type comes from magic bytes and must match `mimeType`.
- The LLM daily budget is spent → 429 `compile_cost_cap`. The per-user daily quota (`LLM_USER_DAILY_COMPILES`, shared with text compiles) is spent → 429 `compile_quota_exceeded`.

Model: `LLM_VISION_MODEL` (default `openai/gpt-4o-mini`). The image is sent as an `image_url` data URI content part, and the prompt tells the model that text in the image is data, not instructions. The call is under the shared `budgeted` reserve/settle and in-flight cap.

If the AI output is invalid, busy, or timed out: with a `note`, it falls back to the demo compile of the note. Without one, it returns an `error` line `compile_failed` that asks for a note. Failed reads refund the user's quota.

Privacy: the image is never stored or logged. The audit gets only `compile.image` with `mime:WxH:bytes:sha256-prefix`.

## M5.7 Shareable video replays (API + data; renderer is a stub)

A share is a **frozen** snapshot of the M4.4 replay, taken when it is created; later run activity does not change it. Only paper and testnet runs can be shared, at most 20 active shares per user.
- `POST /v1/runs/:id/replay/share` (owner, 10/min): body `CreateReplayShareReq` `{ title?≤80, frameMs=60000, maxFrames 10–500 =300, from?, to?, render?: RenderSpec }`. Returns 201 `ReplayShareView` `{ token:"rpl_…", path:"/v1/public/replays/<token>", runId, title, createdAt, revokedAt, frames, digest, render: RenderJob }`. Errors: 404 for someone else's run; 422 for a live run, an empty range or bad params; 429 `limit_exceeded` past 20.
- `GET /v1/me/replays` → `{ items: ReplayShareView[] }`, newest first, revoked ones included.
- `POST /v1/replays/:token/render` (owner, 5/min): body `RenderSpec` `{ aspect:"9:16"|"16:9"|"1:1" ="9:16", fps:24|30 =30, durationSec 5–60 =20 }` → 202 `RenderJob`. 409 while a job is queued or rendering, or if the share is revoked.
- `DELETE /v1/replays/:token` (owner) → 204. The public link becomes 404 and any queued job is cancelled.
- `GET /v1/public/replays/:token` (no auth, 60/min/IP, `noindex`): returns `PublicReplay`, the replay fields minus `runId`, plus `{ token, title, handle, strategyName, mode, createdAt, render:{status, videoUrl, posterUrl} }`. It contains no run, user or account ids.
- `RenderJob` `{ status: none|queued|rendering|done|failed|not_configured, jobId, renderer, spec:{aspect,fps,durationSec,width,height,totalFrames}|null, requestedAt, finishedAt, videoUrl, posterUrl, error }`. Sizes: 9:16 → 1080×1920, 16:9 → 1920×1080, 1:1 → 1080×1080.
- The renderer is pluggable (`ReplayRenderer` in `src/replay/render.ts`). The shipped `stub` produces no video and finishes jobs as `not_configured`. The UI should show the replay player from the frames and hide "download video" until `status=done`. A worker loop runs every 5 s.

## M5.8 Telegram and X alert adapters (stubs)

The webhook is unchanged: `/v1/alerts/settings` and HMAC signing behave as before, and every M4.x webhook test still passes. Telegram and X are pluggable `ChannelAdapter`s (`src/alerts/channels.ts`). They validate the destination and render the exact text, but **never call Telegram or X**.
- `GET /v1/alerts/channels` → `{ items: AlertChannel[] }`. Each `AlertChannel` is `{ name:"telegram"|"x", label, primary, status:"ok"|"stub"|"not_configured", target|null, targetHint, maxMessageLength }`. `status` is `not_configured` when the token env is unset and `stub` when it is set but the sender isn't wired. It is never `ok` yet.
- `PUT /v1/alerts/channels/:name` with body `{ target: string≤64 | null }` → `AlertChannel`.
  - Telegram targets: a numeric chat id (5–16 digits, optional leading `-`) or `@channel`.
  - X targets: a handle of up to 15 characters; `@` is added if missing.
  - `null` clears the target. An invalid target → 422 `validation_failed` with `details.field="target"`; an unknown channel → 404.
- Fan-out: each matching rule event and each `POST /v1/alerts/test` makes the usual primary delivery, plus one delivery per channel that has a target. Each has `provider: "telegram"|"x"` in `/v1/alerts/deliveries`. Stub deliveries end immediately as `status:"not_configured"`, with `lastError` saying nothing was sent, and are never retried. The response body of `POST /alerts/test` is still the primary delivery.
- `AlertProviderName` now includes `"x"`. `ALERTS_PROVIDER=telegram|x` makes that stub the primary (no double delivery).
- New env placeholders `TELEGRAM_BOT_TOKEN` and `X_ALERTS_TOKEN`. Neither is ever used to send.

## M5.9 User-supplied RPC endpoints and AI keys (write-only, encrypted at rest)

- Encryption: AES-256-GCM. The key is HKDF-SHA256 from `SECRETS_MASTER_KEY` (env placeholder: 32 bytes, hex or base64). AAD is `owner:kind:id`, so a row moved to another user doesn't decrypt. Rows store only the ciphertext `v1.<keyId>.<b64>`. The dev snapshot and audit never contain plaintext.
- `GET /v1/me/secrets` → `{ vault:"ok"|"unavailable", items: UserSecretView[] }`. Each `UserSecretView` is `{ id:"sec_…", kind:"rpc"|"ai_key", chainId|null, provider|null, label, hint, status:"ok"|"undecryptable", createdAt, updatedAt, lastUsedAt }`.
  - Values are **never** returned. `hint` is `https://host/…` for RPC (no path, query or credentials) and `sk-or-…abcd` for AI keys.
  - `status:"undecryptable"` means the master key changed; prompt the user to re-enter the value.
- `PUT /v1/me/secrets/rpc` with body `{ chainId: 46630, url ≤512, label? ≤40 }` → `UserSecretView`. It upserts per chain; testnet 46630 only, anything else → 422.
  - SSRF guard (same as webhooks): https only, ports 443/8443, no credentials, no localhost/.local/.internal, no private or reserved IP literals, and every DNS answer must be public.
  - A blocked URL → 422 `rpc_url_blocked`.
- `PUT /v1/me/secrets/ai` with body `{ provider:"openrouter", apiKey: /^sk-or-[A-Za-z0-9_-]{16,200}$/, label? }` → `UserSecretView`. It upserts per provider.
  - When set, the user's own `/v1/compile` and `/v1/compile/image` calls use this key instead of the shared one, and work even when the server has no shared key.
  - Those compiles still count against the platform LLM budget and the per-user quota.
- `DELETE /v1/me/secrets/:id` (owner) → 204; another user's id → 404.
- Limits: 10 writes/min, 10 secrets per user (429 `limit_exceeded`). With no master key, writes → 503 `secrets_unavailable` and the UI should hide the form.
- Not yet wired: a saved RPC URL is stored and validated, but chain reads still use the server's `TESTNET_RPC_URL`. Using it needs viem's transport pinned to the DNS-checked address (rebinding). That is the next step.

## M5.10 Gate fixes (Robin M5 report): changed shapes

- **Handles:** every handle is `publicHandle("@"+label)`: `@label` for plain labels, `@trader_<hmac8>` otherwise. This covers Privy DIDs, email-like and phone-like labels. It applies everywhere: `/public/strategies` `author.handle`, `/profiles/:handle`, `/me/profile`, `/me/following`, `/traders`, copy `sourceHandle`, and replays. A DID never leaves the server.
- **Profile:** new field `limited: boolean`, and `following` is now `number | null`.
  - When `limited` is true (someone else's profile with no public strategies), `displayName`, `bio` and `following` are null.
  - `/me/following` `displayName` is null for traders without public strategies.
- **Unfollow ends copying (the safer option):** `DELETE /profiles/:handle/follow` detaches every copy you hold of that trader.
  - It adds a `warning` event `code:"copy_unfollowed"` to the copy's paper run, then runs `stop_and_flatten` on it, and audits `copy.detach`.
  - `CopyView` gains `detached: boolean` and `detachedAt: Iso | null`.
  - `POST /copy/:id/sync` on a detached copy, or while not following, returns 403 `forbidden` with `details.reason: "detached" | "not_following"`, audited as `copy.sync_blocked`. Following again doesn't revive a detached copy; copy again instead.
- **Copy loop:** `POST /copy` returns 422 when the source's copy or fork lineage (up to 32 levels) contains your own strategy.
- **Wallet link (EIP-4361):** `WalletLinkChallengeRes` is `{ nonce (32 hex), message, expiresAt, domain, uri, chainId: 46630, version: "1" }`.
  - The message follows the SIWE layout: `<domain> wants you to sign in with your Ethereum account:\n<EIP-55 address>\n\n<statement>\n\nURI / Version / Chain ID / Nonce / Issued At / Expiration Time / Request ID`.
  - Domain and URI come from the new env `SIWE_ORIGIN` (default `http://localhost:3000`).
  - A wallet already linked to another account, as its primary or a linked wallet, returns 409 `conflict` with `details.reason: "wallet_in_use"` at both the challenge and the verify step.
- **Chain status:** I picked an explicit disabled shape. `GET /chain/testnet/status` stays **200** and gains `enabled: boolean`. With reads off it returns `enabled: false, reachable: false, chainIdMatches: null, blockNumber: null`, and `reasons` includes the off reason. `/chain/testnet/accounts/:address` still returns 503 `venue_unavailable`.
- **EIP-55:** account reads checksum the address, sessionKey and tokens before reading, so the response `address` is EIP-55.
- **Run:** new field `blockedFills: int`. It counts fills that resolved after a timed-out stop and were refused, never applied.
- **Images (`/compile/image`):** each format now gets a structural check.
  - PNG: chunk CRCs, IHDR first and IEND last with nothing after it, IDAT fully inflated to exactly the expected size (capped, so no bomb), and valid filter bytes. Non-interlaced only.
  - JPEG: a full marker walk SOI…SOF…SOS…EOI with no trailing bytes.
  - WebP: the RIFF size must equal the file size, and the chunk walk must contain image data.
  - Pixel area is capped at 8,388,608 (`bad_dimensions`). A data-URL prefix must equal the declared type (`type_mismatch`). Structural failures return `corrupt`.
- **Replay titles:** stored as plain text: NFC, with control, format (bidi, zero-width), private-use and unassigned characters turned into spaces, `<>` removed, spaces collapsed, and at most 80 code points. A title that ends up empty falls back to "<strategy> replay".
- **X alert target:** `@` plus 4–15 characters from `[A-Za-z0-9_]`, no "twitter" or "admin", not all digits. Anything else returns 422 with field target. The hint text changed.
- **Vault:** the GCM auth tag is pinned to 16 bytes (`authTagLength: 16`) on both seal and open, and blobs shorter than IV plus tag are rejected.
- **RPC use-time check (INFO):** `userRpcFor(uid, chainId)` is now the only path to a stored RPC URL. It decrypts the URL, re-runs the shape and DNS SSRF checks, and returns `{ url, address, family }` so the caller can pin the connection to that address. A rebinding gives `rpc_url_blocked`. It is still not wired into chain reads.

## M5.11 Wallet linking fails closed without SIWE_ORIGIN

- `SIWE_ORIGIN` no longer has a default. When it is unset or empty, `POST /v1/wallets/link/challenge` and `POST /v1/wallets/link/verify` return **503 `wallet_link_unavailable`**, and `GET /v1/auth/config` returns `walletLink.enabled: false` (the field was `true` only before; it is now a boolean).
- Dev only: `QUIVR_MODE=mock` **and** `SIWE_DEV_LOCALHOST=true` fall back to `http://localhost:3000`. An explicit `SIWE_ORIGIN` always wins. An invalid origin fails config load.
- `.env.example` now has `SIWE_ORIGIN=` (empty) and `SIWE_DEV_LOCALHOST=false`.
- Wren: hide the "Link wallet" button when `walletLink.enabled` is false, and map `wallet_link_unavailable` to "Wallet linking isn't available yet."

## M5.12 Activity feed

`GET /v1/activity?scope=all|following|mine&limit=1..50 (default 20)&cursor=…` requires auth and is rate-limited to 120/min per user. Items are newest first. `nextCursor` is opaque (null on the last page). An unknown cursor returns an empty page; a bad `limit` or `scope` returns 422.

```ts
ActivityItem = {
  id: string,                       // stable, opaque
  kind: "strategy_published"|"strategy_updated"|"run_started"|"run_stopped"|"copy_started"|"copy_detached",
  at: IsoTime,
  actor: { handle: Handle, isYou: boolean },
  strategy: { publicStrategyId: string|null, name: string, version: number|null }, // null id = private (yours)
  run: { runId, mode: "paper"|"testnet"|"live", status } | null                   // only on your own items
}
ActivityRes = { items: ActivityItem[], nextCursor: string|null }
```

- `following`: publish and new-version events of public strategies by the traders you follow. They disappear on unfollow. Demo seed traders show publishes only.
- `mine`: your run starts and stops, plus your copy starts and detaches (the actor is you).
- Privacy: no user ids, no other user's private strategy or run ids. A trader's runs are never shown to followers; `publicStrategyId` appears only when the strategy is public.

## M5.13 Stored user RPC and AI keys used at call time

- `GET /v1/chain/testnet/accounts/:address`: if you've saved an RPC for chain 46630 (`PUT /me/secrets/rpc`), the read goes through it. On every call, `userRpcFor` re-checks the URL shape and DNS against SSRF rules; the socket then connects only to the vetted IP, while SNI and Host keep the hostname (`src/chain/pinned.ts`). The connection is https only, does not follow redirects, caps responses at 1 MB, and uses the CHAIN_READ_TIMEOUT_MS timeout. The read-only method guard and the chain-id pin still apply.
- New response header `x-quiver-rpc: user|server`. The body shape is unchanged.
- If DNS for a saved RPC now resolves to a private or reserved address, the read returns **422 `rpc_url_blocked`** and sends nothing. Users without a saved RPC keep the server reader (503 `venue_unavailable` when it's off).
- A saved RPC's `lastUsedAt` is updated on use.
- AI keys: `/compile` and `/compile/image` already used the saved key (M5.9). `POST /runs/:id/instruct` now does too, falling back to the server key.

## M5.14 Real Telegram and X alert senders

- `TELEGRAM_BOT_TOKEN` (BotFather token) and `X_ALERTS_TOKEN` (an OAuth2 user token with `dm.write`) are empty placeholders. Empty means `status: "not_configured"` and no HTTP call. Set means `status: "ok"` and real sends. `"stub"` stays in the enum for older clients but is no longer emitted.
- Telegram: `POST https://api.telegram.org/bot<token>/sendMessage {chat_id, text, disable_web_page_preview}`. X: `GET /2/users/by/username/:h` (cached), then `POST /2/dm_conversations/with/:id/messages`. Hosts are fixed and redirects are refused; the user only supplies the chat id or handle.
- Bounds: 5 s timeout and a 64 KB response cap per call. Each attempt retries once (250 ms) on network errors or 5xx, then hands off to the existing delivery queue backoff (ALERT_MAX_ATTEMPTS). A 429 is retryable and honours retry_after. Other 4xx are final with plain messages (403 "bot can't message that chat" / "recipient must allow DMs", 404 "X user not found", 401 "token rejected").
- Local rate limits: Telegram 25/s globally and 20/min per chat; X 100 per 15 min globally and 5/min per recipient. Going over returns a retryable 429 without calling out.
- Tokens are redacted from every error string. Tests mock all HTTP (`channelHttp` hook) and make global `fetch` throw.
- Wren: the channel `status` is now `"ok"` when configured. A delivery reaches `"delivered"`, or `"failed"` with `lastError`.

## M5.15 Local ffmpeg replay renderer (opt-in)

- `REPLAY_RENDERER=stub|ffmpeg` (default `stub`, which behaves exactly as in M5.7). Other env: `FFMPEG_PATH=/usr/bin/ffmpeg`, `REPLAY_RENDER_DIR=./data/renders`, `REPLAY_RENDER_MAX_SEC=90`, `REPLAY_RENDER_MAX_BYTES=20000000`, `REPLAY_RENDER_MAX_QUEUE=20`.
- How it renders: each frozen replay frame is drawn in-process as a small RGB equity-line chart with a progress bar (deterministic, no fonts, no network). The frames are piped to local ffmpeg, which scales them to the spec size (1080x1920, 1920x1080 or 1080x1080) at the spec fps and duration, then encodes H.264 mp4 (+faststart) plus a PNG poster from the last frame.
- Safety:
  - ffmpeg is spawned with a fixed argv: no shell and an empty env.
  - Output paths come only from the validated share token (`rpl_` plus 32 characters) inside a fixed dir.
  - A wall-clock SIGKILL timer, an ffmpeg `-fs` size cap plus a post-check, and atomic rename (no half-written files are served).
  - One job runs at a time; overlapping ticks are no-ops.
  - Queue cap: `POST /replays/:token/render` returns 429 `rate_limited` when the queue is full.
  - Revoking deletes the files.
- New public routes (no auth, 30/min per IP): `GET /v1/public/replays/:token/video.mp4` and `/poster.png`.
  - They return 200 with `content-type` video/mp4 or image/png, `nosniff`, `content-disposition: inline`, `cache-control: public, max-age=300`, `x-robots-tag: noindex`, and CSP `default-src 'none'`.
  - They return 404 unless the share exists, isn't revoked, and its render is `done`.
- Contract change for Wren: `render.videoUrl` / `posterUrl` can now be an absolute URL or a same-origin path `/v1/public/replays/<token>/video.mp4|poster.png`; resolve it against the API origin. Status flow: queued → rendering → done | failed (with `error`).
- Not supported (deliberately): Range requests (files are ≤20 MB), CDN upload, text overlays.

## M5.16 CORS expose header + public trader activity

- CORS: `Access-Control-Expose-Headers: x-quiver-rpc` is sent for allowed origins (credentialed and anonymous), so the browser can read `x-quiver-rpc: user|server` from `/chain/testnet/accounts/:address`.
- `GET /v1/activity?handle=@x[&limit=1..50&cursor=]` (auth, 120/min per user). When `handle` is set, `scope` is ignored.
  - Response: `ActivityRes` + `limited: boolean`, i.e. `{ items: ActivityItem[], nextCursor: string|null, limited }`.
  - Items: `strategy_published` / `strategy_updated` for the trader's public strategies, plus `run_started` / `run_stopped` for that trader's **paper** runs of those public strategies that started after publishing.
  - Privacy: `run` is always `null` and ids look like `pub.<publicId>.<v>`, `upd.<publicId>.<v>` and `prs|prx.<publicId>.<n>`. No run ids, private strategies, copies, testnet/live runs, user ids or DIDs.
  - `actor.isYou` is true when you view your own handle. Demo handles return their publish/update items.
  - M5.10 rule: a real user with no public strategies (and not you) returns `{ items: [], nextCursor: null, limited: true }`.
  - Errors: unknown handle → 404 `not_found` "Trader not found."; malformed handle (no `@`) → 422.

## M5.17 Global search (⌘K)

- `GET /v1/search?q=<1..80 chars>&limit=1..20 (default 8)`. Requires auth; rate limit 60/min per user; 422 on an empty or over-long `q`.
- Response: `{ q, markets: [{ id, symbol, name, venue, assetClass }], strategies: [{ publicStrategyId, name, handle }], traders: [{ handle, strategies, isYou }] }`.
- Ranking: case-insensitive exact match, then prefix, then substring.
- Public data only: markets come from the registry; strategies are public ones only; traders must have at least one public strategy (M5.10 limited users never appear). No user ids or DIDs.

## M5.18 — optional Tiingo history + external-wallet copy "coming soon"

**Tiingo (stock/ETF only, paper/read-only).** Active only when `TIINGO_API_KEY` is set (empty placeholder by default; provided by Gofi).
- Daily: `GET https://api.tiingo.com/tiingo/daily/<sym>/prices?startDate&endDate` (adjusted OHLC, bar stamped 21:00Z of its date).
- Intraday: `GET https://api.tiingo.com/iex/<sym>/prices?startDate&endDate&resampleFreq=1min|5min|15min|1hour|4hour` (`date` = bar start; stamped at bar end; unfinished bars dropped).
- Hardening (`src/venues/tiingo.ts`): key only in `Authorization: Token …` (never in URL/logs; log lines redact it), 8 s timeout, 4 MB response cap (streamed), `redirect: "error"`, LRU cache (200 entries, 15-min TTL), in-flight dedupe, 45 requests/hour budget. Any failure → `null` → current source.
- `GET /v1/markets/:id/history` → new required field **`dataSource: "tiingo" | "fallback"`**. With Tiingo: `synthetic:false`, `notice:null`, `coverage:[{source:"tiingo_daily"|"tiingo_iex", from, to, gaps:0, synthetic:false}]`.
- `POST /v1/backtests` / `GET /v1/backtests/:id` → new required field **`dataSource: "tiingo" | "fallback"`** (`"fallback"` while queued). `"tiingo"` only when every stock/ETF instrument in the strategy loads from Tiingo at the backtest resolution (1m/5m/15m/1h IEX, 1d daily), with warm-up history (30 days intraday, 400 days daily); otherwise the whole backtest uses the current source. `dataCoverage[].source` = `tiingo_daily`/`tiingo_iex` for those instruments; caveat "Stock/ETF bars come from Tiingo (the underlying stock's adjusted history, not the token)."
- Non-stock instruments, an unset key, or an unsupported timeframe → `"fallback"` without any HTTP call.
- Test hook: `AppOptions.tiingoHttp: (req:{url,headers,timeoutMs,maxBytes}) => Promise<{status,text}>`.

**External-wallet copy = coming soon.** New error code `not_available` → HTTP **501**.
- `GET|POST /v1/copy/wallet`, `/v1/copy/wallet/:a`, `/v1/copy/wallet/:a/:b` → `501 {error:{code:"not_available", message:"Copying an external wallet is coming soon. …", details:{feature:"external_wallet_copy"}}}`.
- `POST /v1/copy` with any of `address|wallet|walletAddress|externalWallet` in the body → same 501 (nothing stored). Copying Quiver public strategies is unchanged.

Tests: `test/integration/m518.test.ts` (9 tests, mocked HTTP/fetch only).

## M5.19 — daily stock/ETF backtests fill at the next session's open

- Applies only to `resolution: "1d"` backtests and only to Robinhood Stock Token equity/ETF orders. Crypto/perps/24-7 and all intraday resolutions are unchanged.
- Decision: at the daily bar's close (t = boundary − 1 ms), using only data up to that close. An order decided on a **trading day** (NY date, `isTradingDay`) is accepted even though the session is post/closed; on weekend/holiday decisions it is still refused `market_closed` (no new bar).
- Fill: queued for the first regular-session instant (09:30 ET, 15-min calendar scan up to 10 days, skips weekends/NYSE holidays). It fills at the **open of the first bar with data covering/after that instant**, and only once that bar has finished by the loop time (`MarketData.openAt?(id, t, now)`, implemented by `TiingoOverlay`; default = `price(id, t)`). Price = open + modeled half-spread + √-impact (`session:"open"`), fill `ts` = the open time (e.g. `13:30Z` EDT / `14:30Z` EST). A data gap waits for the next bar.
- Queued orders are settled before each bar's decision (`Executor.settleAtOpen`), so the next close sees the position.
- End of range: still-queued orders are **not** filled; caveat `"N order(s) decided near the end of the range were still waiting for the next open and were not filled."`
- Caveats for daily stock backtests: `"Daily bars: Stock/ETF orders are decided on the bar's close and fill at the next session's open (skipping weekends and holidays) with modeled slippage."` replaces "Stock Token orders are not placed while the US market is closed…".
- No contract/shape change. Tests: `test/unit/m519.test.ts` (4).

## M5.20 — public profile + Robin gate findings (M5.11–15/M5.19 report)

### GET /v1/public/profiles/:handle (no auth, for Wren)
- 200 `PublicProfile` (contracts/src/public.ts, strict): `{ handle, exists: true, limited, displayName: string|null, bio: string|null, publicStrategies: int, followers: int, demo: boolean }`.
- M5.10 limited rule: an account with 0 public strategies → `limited: true`, `displayName`/`bio` null. Demo (seed) traders: `demo: true`, never limited.
- 404 `not_found` for unknown, invalid or badly-encoded handles. No user ids, DIDs, labels, wallets, strategy/run ids.
- 60/min per IP (`429 rate_limited` + Retry-After), `cache-control: public, max-age=30`, `x-robots-tag: noindex`. Added to the auth-allowlist test (m34).

### Findings fixed
- **Medium, replay memory:** `frameIter` generator draws one canvas incrementally and streams frames to ffmpeg one at a time (backpressure via drain). Internal canvas 180 × ≤320 (`MAX_IH`), ≤900 frames (`MAX_FRAMES`, equity downsampled). Peak frame memory ≈ 2 × 173 KB (was ≈311 MB). Poster uses `frameIter(…, "last")`. `drawFrames` kept (capped) for compatibility.
- **Low, FFMPEG_PATH:** config refuses non-absolute paths (`/…` or `C:\…`), `..` segments, NUL/CR/LF → boot fails. Default `/usr/bin/ffmpeg` unchanged.
- **Low, Tiingo per-user cap:** `TiingoHistory.bars(…, owner?)`; each user ≤15 network calls/hour (`maxPerOwnerHour`) within the global 45/h; cache hits are free; over the cap = `dataSource: "fallback"` (no error). History uses the caller, backtests the run owner.
- **Info, search:** `/v1/search` no longer echoes `q` (`SearchRes.q` now optional, omitted). Queries shorter than 2 characters return no traders (stops one-letter handle sweeps); the 60/min per-user limit stays.
- **Info, SIGNOFF §9:** rows added for CHAIN_ID, NODE_ENV, RPC_URL, AA_PROVIDER, LLM_PROVIDER, VERIFIED_READONLY_PATH, and explicit rows for PRIVY_VERIFICATION_KEY, PRIVY_JWKS_URL, TESTNET_SESSION_ACCOUNT_CODEHASH, ALERTS_EMAIL_API_KEY; FFMPEG_PATH and TIINGO rows updated.
- Tests: `test/integration/m520.test.ts` (7).

## M5.21 — Robin M5.20 gate fixes (B6, W1/B1, B2, B3)

- **B6, listen first:** `main.ts` now calls `listen()` before any price-history work. Jupiter refresh, `market.refresh()` (1 y of RPC history) and the Tiingo EOD load run in the background via `Warmup` (`src/warmup.ts`) under `WARMUP_MAX_MS` (default 30 s). States: `warming | ready | partial | timeout | off` (`off` = no history source, e.g. mock). A timeout does not stop the load; the 60 s refresh timer keeps filling data.
  - New `GET /v1/health` (public, no auth): `{ ok: true, ready: boolean, warmup: { state, startedAt, finishedAt, errors, message }, notice: string|null }`. `/v1/status` gains `warmingUp: boolean`.
  - While warming: market history `notice` = "The server is warming up after a restart: price history is still loading, so results use the data loaded so far." (unless the data came from Tiingo); finished backtests get the same text as the first caveat. Other endpoints use whatever prices are loaded (unchanged fail-closed behaviour for missing prices).
- **W1/B1, internal web-proxy bucket:** new env `INTERNAL_PROXY_TOKEN` (≥32 chars, empty placeholder). A request with header `X-Quiver-Internal-Token: <token>` from a loopback TCP peer (127/8, ::1, ::ffff:127/104), compared with `timingSafeEqual` on SHA-256 digests, is limited under a separate `<name>:internal` key at 20× the public cap. Applies to public profiles (1200/min), cards, replays, replay media, leaderboard, landing. Otherwise (unset, wrong, or non-loopback) the normal per-IP limit applies. Auth and ops limits are unchanged.
  - **Wren:** on server-side fetches to the API (Next.js route handlers / RSC for /u/:handle etc.), add header `X-Quiver-Internal-Token: process.env.INTERNAL_PROXY_TOKEN`, call the API on 127.0.0.1 directly, never expose the token to the browser (no `NEXT_PUBLIC_`), and keep forwarding nothing user-controlled as XFF.
- **B2, TRUST_PROXY:** documented as "only behind Caddy on the same host". New `TRUST_PROXY_PEERS` (default `loopback`): XFF is honoured only when the TCP peer is loopback; `any` restores the old behaviour.
- **B3:** the renderer comment now states the measured ~52–71 MB peak (bounded, flat in N).
- Tests: `test/integration/m521.test.ts` (7); `/health` added to the auth allowlist (m34).

## M5.22 Slice A — machine-readable warmup + HealthRes (Sage, 2026-10-28)
For Wren: stop matching the text "The server is warming up". Branch on these fields instead.
- `WarmupNotice` (contracts/src/common.ts) = `{ code: "warming_up", message: string }`.
- `MarketHistoryRes` (GET /v1/markets/:id/history) and `BacktestRes` (GET /v1/backtests/:id, SSE `done`) gain:
  - `warmup: boolean` (default false). True while the server warms up after a restart and the bars came from the fallback source (Tiingo-backed responses are never flagged).
  - `warmupNotice: WarmupNotice | null` (default null).
  - Existing `notice: string|null` (history) and `result.caveats[0]` (backtest) are unchanged; additive, backward compatible.
- `HealthRes` (contracts/src/ops.ts), GET /v1/health, public, strict:
  `{ ok: true, ready: boolean, warmup: { state: "warming"|"ready"|"partial"|"timeout"|"off", startedAt: IsoTime|null, finishedAt: IsoTime|null, errors: int≥0, message: string|null }, notice: WarmupNotice|null }`.
  **Breaking vs M5.21:** `/health.notice` was a string; it is now the `WarmupNotice` object (or null).
Tests: test/integration/m522.test.ts (3).

## M5.22 Slice B — paper revenue ledger (PARITY "Rewards / Revenue", Sage, 2026-10-28)
- Env (off by default; `.env.example` placeholders): `REVENUE_ACCOUNTING_ENABLED=false`, `CREATOR_SHARE_BPS=` (int 0..5000, product decision). Both needed to turn it on.
- `RevenueRes` gains `accounting: "off" | "paper_ledger"` (default "off"). Additive.
- When on: per public strategy, `followersVolumeUsd` = sum of `notionalUsd` and `earnedUsd` = floor(sum `feeUsd` × bps / 10000) over **paper** fills of OTHER users' strategies that copy (`copyOf.publicStrategyId`) or fork (`forkedFrom`) it. Own forks and testnet/live runs never accrue. Integer cents. `creatorSharePct` = bps/100 ("20.00"). `claimableUsd` stays "0.00", `claimEnabled` stays false, `mock` stays true: nothing is paid.
- Real distribution (on-chain payout/claim) still needs the token/fee-split decision and is not built.
Tests: test/integration/m522b.test.ts (4).

## M5.22 Slice C — M2 testnet 46630: V1–V4 status + own test venue script (Sage, 2026-10-28)
| Item | Status | Blocker | What unblocks it |
|---|---|---|---|
| V1 Uniswap Universal Router on 46630 | FAIL | Contract on 46630 has a different bytecode hash and no official Uniswap listing for 46630 | Uniswap publishes a 46630 deployment (or Robinhood lists one), then re-run `npm run verify:testnet` |
| V2 Uniswap Trading API | FAIL | API rejects chainId 46630; also needs an API key | Uniswap support for 46630 + `UNISWAP_API_KEY` (user) |
| V3 0x | FAIL | 0x supports 4663 only | 0x adds 46630 + `ZEROX_API_KEY` (user) |
| V4 Stock Tokens on testnet | FAIL | All 195 RH assets exist on 4663 only | Robinhood testnet Stock Tokens; none we can create |
Workaround built (no key, nothing signed or deployed): `foundry/script/DeployTestPool.s.sol` deploys OUR test venue on 46630/anvil only — tUSDG(6), tNVDA(18, test stand-in, not a Stock Token), MockPool @ 200, two test feeds. Refuses 4663/1. Signer comes from forge `--ledger` or `--account <keystore>` + `--sender $DEPLOYER_ADDRESS`; no private key in env. Tests: `foundry/test/DeployTestPool.t.sol` (5); anvil dry run (simulation only) OK.
To broadcast on 46630 the user/Robin must provide: a funded testnet deployer (faucet ETH, faucet is wallet-connect only), the deployer's public address, and run the command with their own Ledger/keystore after Honey's approval. Then Sage registers the pool in a `self-test-venue` verification entry (follow-up; not built).

## M5.23 Slice 1 — SIGNOFF §9 DEPLOYER_ADDRESS + §9.1 testnet broadcast steps (Sage, 2026-10-28)
SIGNOFF §9 rows: DEPLOYER_ADDRESS, TEST_POOL_SEED_NVDA, TEST_POOL_ENABLED, TEST_POOL_ADDRESS/TEST_USDG_ADDRESS/TEST_NVDA_ADDRESS, TEST_POOL_RPC_URL (all empty placeholders in .env.example). §9.1: wallet → faucet → Ledger or encrypted keystore → dry run → broadcast (after approval) → addresses into env → check. Docs only.

## M5.23 Slice 2 — `POST /v1/testnet/deposit/prepare` (auth, testnet 46630 only)
Returns an **unsigned** tx for the user's own wallet to sign and send. Server never signs/broadcasts.
- Req `DepositPrepareReq` (contracts/src/testnet.ts): `{chainId:number, asset:"ETH"|"tUSDG", amount:"0.05", from:0x..}` (strict).
- Res `DepositPrepareRes`: `{tx:{chainId:46630, from, to, data, value(wei string)}, asset, amount, amountBaseUnits, decimals, recipient, token|null, humanReadable, testnet:true, preparedAt, notice}`.
  - ETH: `to`=recipient smart account, `data:"0x"`, `value`=wei. tUSDG (6 dp): `to`=TEST_USDG_ADDRESS, `value:"0"`, `data`=`transfer(recipient, units)`.
- Recipient = caller's latest pending/active 46630 session-key smart account.
- Errors: 422 `validation_failed` reason `chain_not_allowed` (any chainId ≠ 46630, or server in mainnet mode) / `amount_out_of_range` (ETH ≤1, tUSDG ≤1,000,000) / `too_many_decimals`; 409 `conflict` reason `wallet_not_linked` (`from` not in linkedWallets) / `no_smart_account`; 503 `venue_unavailable` (tUSDG with TEST_USDG_ADDRESS empty); 401; 429 at 20/min/user.
- Config keys added: TEST_POOL_ENABLED, TEST_POOL_ADDRESS, TEST_USDG_ADDRESS, TEST_NVDA_ADDRESS, TEST_POOL_RPC_URL (all optional/empty by default).
- Tests: test/integration/m523.test.ts (5).

## M5.23 Slice 3 — test pool wiring (`/v1/testpool/*`, testnet 46630)
Enabled only when `TEST_POOL_ENABLED=true` AND `TEST_POOL_ADDRESS`, `TEST_USDG_ADDRESS`, `TEST_NVDA_ADDRESS` are all set (never in mainnet mode). The RPC (`TEST_POOL_RPC_URL`, falls back to `TESTNET_RPC_URL`) must report chainId 46630 or every route returns 503. Only `eth_call` is used (src/testpool.ts has no wallet client).
- `GET /v1/testpool/status` (public, 60/min/IP) → `TestPoolStatusRes {enabled, chainId:46630, pool|null, usdg|null, nvda|null, missing:string[], notice}`.
- `GET /v1/testpool/quote?side=buy|sell&amount=` (auth, 60/min) → `TestPoolQuoteRes {side, tokenIn, tokenOut, symbolIn, symbolOut, amountIn, amountInUnits, amountOut, amountOutUnits, priceUsdgPerNvda, feeBps:30, reserves{usdg,nvda}, quotedAt, testnet:true}`. buy = tUSDG→tNVDA.
- `POST /v1/testpool/swap/prepare` (auth + linked wallet, 20/min) body `TestPoolSwapPrepareReq {chainId(must be 46630), side, amount, from, slippageBps 1–500 (default 50), deadlineSec 60–1800 (default 600)}` → `TestPoolSwapPrepareRes {txs:[{kind:"approve"|"swap", tx:UnsignedTx, description}], quote, minAmountOut, minAmountOutUnits, slippageBps, deadline, testnet:true, notice}`. The approve tx is left out when the allowance already covers the amount. Swap output goes to `from`. The user's wallet sends the txs in order.
- Errors: 503 `venue_unavailable` (disabled, with `details.missing`, or RPC not on 46630) / `quote_unavailable` (read failed or zero out); 422 `chain_not_allowed`, `too_many_decimals`, `amount_out_of_range`, schema; 409 `wallet_not_linked`.
- Tests: test/integration/m523-testpool.test.ts. 3 unit tests use a fake reader. 1 anvil test runs the real DeployTestPool.s.sol with `--unlocked` on anvil's dev account (no key used), checks the quote against `pool.quote` and that no block is written, then sends the prepared approve and swap txs from an unlocked anvil account and checks balances (buy and sell). It is skipped when Foundry is missing. foundry/broadcast/ is gitignored.

## M5.24a — validation rejects don't consume rate limits or quota
- A request that ends in 422 `validation_failed` or 413 `payload_too_large` gets back every rate-limit slot and compile-quota slot it took, via a per-request ledger in AsyncLocalStorage. All other errors (401/403/404/409/412/503, `unsupported_prompt`, …) still count.
- Invalid requests have their own cap of 120/min per IP (`inv:<ip>`). Going over it returns 429 with Retry-After.
- No contract change. Clients may now retry corrected input right away.
- Also fixed a flaky M5.23 anvil test: viem was caching the block number.
- Tests: test/integration/m524a.test.ts (4).

## M5.24b — low-s signatures only
- `POST /v1/wallets/link/verify` and `POST /v1/session-keys/submit` accept only canonical 65-byte ECDSA signatures with s ≤ n/2 (EIP-2) and v ∈ {27,28,0,1} (src/auth/lowS.ts). The high-s twin, which viem's verify alone would accept, is refused:
  - wallet link → 422 `wallet_link_invalid` (the nonce is burned as before);
  - session key → 422 `session_key_policy_violation`, "…canonical (low-s)…".
- Browser wallets (viem/ethers/MetaMask) already produce low-s, so nothing changes for clients. Compact 64-byte (EIP-2098) and ERC-1271/6492 smart-wallet signatures are not accepted. They weren't before either, because verification is EOA-only.
- Tests: test/integration/m524b.test.ts (3).

## M5.24c — JWKS refetch cooldown + single-flight (Privy)
- JWKS fetches are now at least 30 s apart (`PrivyOpts.jwksMinIntervalMs`). Inside that window:
  - a token with an unknown `kid` → 401 "unknown key id", with no fetch;
  - a recent failed fetch → 503 `auth_unavailable`, with no retry.
- Concurrent cache misses share a single in-flight fetch.
- Key rotation is still picked up on the first miss after the interval (cache TTL is 10 min, as before).
- No contract change. Tests: test/unit/m524c-jwks.test.ts (3).

## M5.24d — deposit prepare checks the smart account is deployed
- When a 46630 RPC is available (injected, `TEST_POOL_RPC_URL` set, or `QUIVR_MODE=testnet`) and reports chainId 46630, `POST /v1/testnet/deposit/prepare` reads `eth_getCode(recipient)`.
  - No code → 409 `conflict`, `details: {reason: "smart_account_not_deployed", recipient}`.
  - Code present → `recipientCode: "verified"`.
- No RPC, wrong chain or a failed read → `recipientCode: "unchecked"`. A dead RPC never blocks the deposit.
- **Contract:** `DepositPrepareRes.recipientCode: "verified" | "unchecked"` (new, required).
- Tests: test/integration/m524d.test.ts (4).

## M5.24e — swap prepare checks the token balance
- `POST /v1/testpool/swap/prepare` reads `balanceOf(from)` on the input token (read-only) before building the txs. If the balance is too low it returns 422 **`insufficient_balance`**, `details: {token, symbol, have, need, haveUnits, needUnits}`, with message "Your wallet has X tUSDG; this swap needs Y."
- **Contract:** new `ErrorCode` `insufficient_balance` → HTTP 422 (contracts/src/errors.ts).
- Tests: test/integration/m524e.test.ts (2). The anvil e2e now also checks this before funding: `have:"0", need:"200"` from the real token.

## M5.24f — optional tNVDA deposit
- `DepositPrepareReq.asset` / `DepositPrepareRes.asset` are now `DepositAsset = "ETH" | "tUSDG" | "tNVDA"`.
- tNVDA: 18 dp, cap 10,000. The tx is `{to: TEST_NVDA_ADDRESS, value:"0", data: transfer(recipient, units)}`. It returns 503 `venue_unavailable` while `TEST_NVDA_ADDRESS` is empty. tNVDA is a test stand-in, not a Robinhood Stock Token.
- Tests: test/integration/m524f.test.ts (3).

## M5.25: Robin gate fixes (M5.24 report)
- **Deposit prepare fails closed.** When a 46630 RPC is configured (injected reader, `TEST_POOL_RPC_URL`, or `QUIVR_MODE=testnet`) and the code lookup fails (error, unreachable, or wrong chain), the response is **503 `venue_unavailable`** with `details.reason = "recipient_check_unavailable"`. `recipientCode:"unchecked"` now only happens when no RPC is configured. 409 `smart_account_not_deployed` is unchanged.
- **JWKS:** the 30 s default cooldown stays. It is configurable via `PRIVY_JWKS_MIN_INTERVAL_MS`, but never below 10 s, and that floor is enforced in both config and the verifier. An unknown `kid` after the cooldown triggers exactly one refetch. If the kid is still unknown, the result is 401 with no second fetch until the next cooldown.
- **Per-user invalid cap:** 422/413 requests count toward `invu:<userId>`, `INVALID_PER_USER_PER_MIN` (default 60/min, 0 = off). This is on top of the 120/min per-IP cap, and exceeding it returns 429 with Retry-After.
- **SIGNOFF §9:** the per-IP caps rely on Caddy overwriting `X-Forwarded-For`.
- Tests: test/integration/m525.test.ts (2), test/unit/m525-jwks.test.ts (3). In m524d, the fail-open test is replaced with a fail-closed one that covers 3 failure modes.

## M5.26: bigint caps, HOST, SIGNOFF port, committed checks.sh
- **Caps compare in bigint base units.** Deposit caps (ETH 1, tUSDG 1,000,000, tNVDA 10,000) are now checked with `parseUnits` and not `Number()`, so `1.000000000000000001` ETH gets 422 `amount_out_of_range`. The decimals check (`too_many_decimals`) now runs before the cap check.
- **New swap input caps**, same base-unit compare on `/testpool/quote` and `/testpool/swap/prepare`: buy ≤ 1,000,000 tUSDG in, sell ≤ 10,000 tNVDA in. Over the cap gives 422 `validation_failed`, reason `amount_out_of_range`.
- **`HOST` env** (default `127.0.0.1`) is passed to `serve({hostname})`. On the VPS it replaces the bind.mjs preload (SIGNOFF §9).
- **SIGNOFF §9:** the VPS API port is 8987. 8787 is only the local-dev default.
- **`backend/scripts/checks.sh`** is committed, with paths relative to the script and forge from `$FORGE` or `~/.foundry/bin/forge`. `/workspace/checks.sh` is unchanged and still works.
- Tests: test/integration/m526.test.ts (4).

## M5.27: checks gate + anvil flake (no API changes)
- **Checks no longer regenerate fixtures.** The `FIXTURES_GEN` write step is gone from both `/workspace/checks.sh` and `backend/scripts/checks.sh`. Fixtures are compared in memory against the committed files (`fixtures:gen:check`, `fixtures:check`). A new `TREE_UNCHANGED` step fails the run if any tracked file changes while the checks run (porcelain status plus diff hash, before vs after). Proof: making `contracts/fixtures/alerts.deliveries.json` stale now makes both scripts end with CHECKS FAILED, exit 1.
- **Anvil flake root cause: fixed ports.** `m50-anvil-readonly` and `m523-testpool` both hard-coded 18547, and the other anvil files used 18545 and 18546. This box is shared, so any other run of the suite (another file in the same run, or another agent's run at the same time) could already hold the port. Our anvil then failed to bind, and the test silently used the other process's chain, which could exit mid-run. Repro at the old HEAD: a foreign anvil on 18547 went from block 0x0 to 0x3, because m50 deployed onto it.
- **Fix:** `test/anvil.ts` `startAnvil(chainId)` gives each file an OS-assigned free port and only returns once *our* process is alive and answering `eth_chainId`. `test/global-forge.ts` (vitest `globalSetup`) runs `forge build` once, instead of four files building concurrently into `foundry/out`. Verified with 5 full runs in a row, all 548/548 passing.

## M5.28 (Sage)
- `POST /v1/testnet/deposit/prepare`: the amount is validated (per-asset decimals, then bigint cap) **before** the linked-wallet / session-account / smart-account lookups. A bad amount now returns 422 `too_many_decimals` or `amount_out_of_range` even when the wallet isn't linked (before: 409 `wallet_not_linked` / `no_smart_account` came first). Valid amounts then hit the same 409/503 checks as before.
- Schema-level 422 for more than 18 fraction digits (AmountStr: deposit prepare body, `GET /v1/testpool/quote` query, `POST /v1/testpool/swap/prepare` body): `error.details` is now `{ reason: "too_many_decimals", issues: FriendlyIssue[] }`. All other schema failures keep `details` as the `FriendlyIssue[]` array. Clients: read `details.reason` when `details` is an object, else treat as the issue array.
- `GET /v1/testpool/status` is public and always returns **200**. When the pool is disabled or misconfigured it returns `enabled:false` (with `missing[]` naming absent config), never 503. Clients should gate the swap UI on `enabled`, not on status code.
- `GET /v1/public/strategies/:id` is now **guest-readable** (no auth needed): 60/min/IP (429 `rate_limited`), `x-robots-tag: noindex`, `cache-control: public, max-age=30` for guests (`private, no-store` when a valid Bearer is sent). Body unchanged: `{id,name,author{handle,isYou},venues,forks,paperReturn30dPct,spark,publishedAt,mock,thesis,strategy,humanized,nodes,forkedFrom}`, with no ownerId and no private row data. `author.isYou` is false for guests. 404 `not_found` for unknown ids. `GET /v1/public/strategies` (list) and `POST /v1/public/strategies/:id/fork` still require auth (401).
- Seed id alignment: backend search (`strategies[].publicStrategyId`), profiles (`strategies[].id`) and activity all use the public-strategy ids, so every one resolves via `GET /v1/public/strategies/:id`. The seed ids are `stg_demo0000000000000000000001` (@demo_lena), `…002` (@demo_okafor) and `…003` (@demo_marco). Tested in test/integration/m528.test.ts. Web mocks (lib/api/social-mock.ts PEOPLE) still use `stg_01M5YZQ360…` ids and should switch to these.
