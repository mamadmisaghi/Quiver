# Quiver ($QUIVR) — backend architecture

Status: **DRAFT v0.2** (autonomous-build revision) · Author: Sage · 2026-10-27 (Asia/Tehran, UTC+3:30)
Scope: contracts and design only. The only code is the typed schemas in `contracts/`.
Inputs: `/workspace/research/weft-teardown/REPORT.md`, the Robinhood Chain docs (fetched 2026-10-27), and `web/lib/mock.ts`, which sets the naming.
Legend: **[V]** verified against a public source this session · **[R]** taken from the teardown report and not re-checked · **[A]** our assumption or design choice · **[D#]** decided default (§9).

---

## 0. One-paragraph summary
A user writes a market view in plain English. An LLM **compiles** it into a strategy JSON object that must pass a strict zod schema (`contracts/src/strategy.ts`). The LLM has **no execution authority**: it outputs data, never calls tools that move money, and its output is rejected unless it validates. A **deterministic rule engine** evaluates the strategy on a fixed loop against normalized **signals** (Chainlink, venue prices, Polymarket odds). When a trigger fires, the engine creates an **order intent** and passes it through a **risk gate** to an **executor**. In paper mode the executor is a fill **simulator**. In testnet/live mode it is a **venue adapter** that signs with a **trade-only session key** on the user's smart account. Every step publishes a typed event (`tick`, `trigger_met`, `trigger_fired`, `intent`, `fill`, `error`, `risk_halt`) to an **event bus**, and the frontend receives them over **SSE**. The rollout is paper first, then Robinhood Chain testnet (46630), then mainnet (4663). Mainnet goes live only with the user's explicit approval.

## 1. System diagram
```mermaid
flowchart LR
  subgraph Client["web/ (Wren)"]
    UI[Builder · Run view · Portfolio]
  end
  subgraph API["API service (Hono, Node 20)"]
    AUTH[Auth + eligibility]
    REST[REST /v1]
    SSE[SSE gateway]
  end
  subgraph AI["Compiler (no execution authority)"]
    LLM[LLM structured output] --> VAL[zod + semantic validator] -->|fail| REP[repair loop ≤2]
    REP --> LLM
    VAL --> HUM[deterministic humanizer]
  end
  subgraph Core["Engine workers"]
    SCHED[Scheduler / keeper] --> ENG[Rule engine]
    ENG --> RISK[Risk gate]
    RISK --> EXEC{Executor}
    EXEC -->|paper| SIM[Fill simulator]
    EXEC -->|testnet/live| ADP[Venue adapters]
    BT[Backtester] -.reuses.-> ENG
    BT -.reuses.-> SIM
  end
  subgraph Data["Signals"]
    ORA[Chainlink Data Streams + Feeds]
    VQ[Venue quotes: Uniswap API, 0x, Jupiter, Hyperliquid]
    PM[Polymarket read-only]
    IDX[Indexer: RH Chain logs, receipts]
  end
  subgraph Sign["Signing (isolated)"]
    SIGNER[Session-key signer: KMS / TEE / Privy-like]
  end
  BUS[(Event bus: Redis Streams)]
  PG[(Postgres)]
  TS[(Time-series: Timescale)]
  UI -- HTTPS --> REST
  UI -- EventSource --> SSE
  REST --> AI
  REST --> PG
  Data --> TS --> ENG
  ADP --> SIGNER
  ADP --> IDX
  ENG & RISK & SIM & ADP --> BUS --> SSE
  BUS --> PG
```

## 2. Components

### 2.1 NL → rules compiler (AI)
- **Contract:** input `CompileReq` (thesis, optional base strategy plus refine instruction, ≤2 chart images). Output is an NDJSON stream of `CompileEvent` that ends in `result` (a validated `Strategy` + `Humanized` + `issues` + `usage`) or `error`.
- **Pipeline:**
  1. **Pre-filter:** length limits; strip URLs and markup; label the thesis as untrusted user data inside the prompt.
  2. **Market resolver (deterministic, not the LLM):** the LLM may only output a *symbol plus venue hint*. A server lookup over our curated `instruments` table maps it to an `InstrumentId` and feed. Unknown symbols produce an `unsupported_instrument` issue. The model never invents addresses.
  3. **Structured output:** the provider's JSON-schema mode, using the JSON Schema generated from the zod `Strategy` (`zod-to-json-schema`).
  4. **Validation:** zod parse, then semantic checks: refs resolve, no cycles, the trigger ids in `on` exist, the instrument is tradable for this user (geo), the venue is not read-only for actions (Polymarket), leverage is within caps, and equity signals handle staleness.
  5. **Repair loop:** at most **2 retries**. Each retry feeds back only the structured `ValidationIssue[]`, never the raw stack. On the third failure the stream emits `error: compile_failed` with the last issues so the UI can show what it couldn't do.
  6. **Humanizer (deterministic code, not the LLM):** turns the strategy into Watch / When / Do / Exit lines. The card the user approves is therefore always a faithful rendering of what will execute. The LLM's prose is never shown as the rule.
- **Cost cap [A]:** per call, max input 8k tokens and output 4k, with at most 3 attempts, which puts a hard ceiling of roughly $0.05 on each compile. Per user, a daily quota (default 30 compiles/day, like Weft's 30/day [R]). Globally, a daily budget kill switch: once spend passes the cap, `compile_cost_cap` is returned to everyone and an alert fires. Responses are cached on `hash(thesis, base, instruction, model)`.
- **No execution authority:** the compiler process has no DB write access to runs, no signer access, and no network egress except to the LLM provider. Saving a strategy, and later starting a run, are separate user actions authenticated with the user's token.
- **Vendor (decided, D2):** OpenRouter. The design is provider-agnostic as long as the model supports JSON-schema-constrained output.

### 2.2 Deterministic rule engine
- **Inputs:** a frozen strategy *version* (strategies are immutable once a run starts; edits create version n+1) and the latest `SignalValue`s from the time-series store.
- **Loop:** the scheduler gives every active run a **cycle every 15 s [A]** (Weft advertises 15–30 s [R]). A Chainlink Data Streams update for a referenced instrument can also wake a run early, debounced to at most 1 cycle per 2 s. Each cycle:
  1. Snapshot the signals. A signal older than `maxAgeSeconds` becomes `null` (**unknown**). Under three-valued logic, a comparison with unknown is unknown, and **an unknown trigger never fires**.
  2. Evaluate each trigger's expression tree. `crosses_*` compares against the previous cycle's stored value.
  3. Run the trigger state machine: `ready → holding` (condition true, emits `trigger_met`) → fires once it has held `forMinutes` continuously (emits `trigger_fired`) → `cooldown` → `ready`, or `done` when `maxFires` is reached. If the condition breaks while holding, the state resets to `ready`. `blocked` means risk or session rules prevent firing.
  4. For each action bound to a fired trigger, build an **intent** with an idempotency key `runId:triggerId:fireIndex:actionId`.
  5. Persist the state, then publish `tick` (changed values only) and any edge events.
- **Determinism:** a pure function `(strategy, state, signalSnapshot, clock) → (state', intents, events)`. The same function powers the backtester, so live and backtest semantics cannot drift. Clock and randomness are injected.
- **Concurrency:** one active owner per run, via a Postgres advisory lock or Redis lease with fencing tokens. A crashed worker loses its lease and another resumes from the persisted state.

### 2.3 Risk gate (between engine and executor)
It checks, in order: kill switch → geo eligibility → market session (for equities when `equityWhenFeedStale: skip`) → `maxOrdersPerDay` → `maxPositionPct` / `maxTotalExposurePct` → `maxDailyLossPct` → session-key per-tx / daily caps (pre-checked off-chain; enforced again on-chain) → quote sanity (the quote price must sit within `maxPriceImpactBps` of the oracle reference, and the oracle must be fresh with the sequencer up). A failure emits `rejected` for the order. A breach of a run-level limit emits `risk_halt` and moves the run to `halted`. Only the user can resume.

### 2.4 Paper-trading fill simulator
- **Reference price:** Chainlink Data Streams for Stock Tokens and crypto where a stream exists [V exists on RH Chain]; otherwise the venue mid (Hyperliquid book mid, Jupiter quote).
- **Fill price:** the **real venue quote** for the exact size, requested without sending (Uniswap API / 0x quote on RH Chain, Jupiter quote on Solana, the Hyperliquid L2 book walk). Slippage is the quote's price impact, plus a latency penalty of **max(2 bps, |Δ reference| over the last 5 s)** [A]. If the quote is unavailable, the simulator falls back to reference ± modeled impact (`k·√(notional/poolDepth)`, k calibrated per venue), and the fill is flagged `referenceSource: "model"`.
- **Fees:** the venue fee from the quote (pool fee tier / Jupiter platform fee / HL taker fee), estimated gas in USD on RH Chain, and the Quiver fee (`QUIVR_FEE_BPS`, default 30). Perp funding accrues hourly from HL funding history.
- **Constraints mirrored from live:** limit orders fill only when the reference crosses the limit, and when the quote shows the order would breach `maxSlippageBps` the fill is **rejected**, not filled worse. **M3.1 change:** geo eligibility gates **live Stock Token execution only**. Demo, paper, backtest, quotes and compile are not geo-blocked; a non-eligible user sees `geoRestricted: true` on the market and a `geo_restricted` *warning* (not error) on validate. (This reverses the v0.2 "paper mirrors the live geo gate" choice, at the M3.1 request; flag for legal at final sign-off, T6.)
- **Accounting:** a virtual USD balance per user per run (default $10,000). Positions and PnL live in the same tables as live runs, separated by `mode='paper'`.

### 2.5 Backtester
- **Engine:** replays the same `evaluate()` and simulator over historical bars on a virtual clock. It is an async job (`POST /v1/backtests` → poll or SSE progress).
- **Data sources (D7, free first):** crypto uses Hyperliquid candles and funding history (public API) and DEX OHLCV via the indexer for RH Chain pools. **Stock Tokens:** on-chain history only starts at mainnet launch (2026-07-01 [R]), so a longer backtest needs underlying-equity OHLCV from a free end-of-day source (labeled "Modeled"; a paid vendor is optional via `DATA_VENDOR_API_KEY`) plus a premium/discount model. Polymarket uses its public price history. Each instrument's coverage is returned in `dataCoverage`, and modeled data is flagged `synthetic: true`.
- **Resolution:** 1m / 5m / 15m / 1h / 1d. The engine runs at bar close. The default is 15m. Max range is 365 days in v1.
- **Lookahead-bias guards:**
  1. A signal at time t sees only bars with `closeTime ≤ t`. Indicators are computed incrementally, never on the full series.
  2. Fills execute at the **next** bar's open plus modeled slippage, never at the bar that triggered.
  3. Point-in-time instrument universe: no Stock Tokens before their listing date.
  4. Corporate actions are applied using the ERC-8056 multiplier as of that date [R].
  5. Signal staleness and market-closed periods are replayed (the feed is 24/5, while pools trade 24/7).
  6. No parameter optimization in v1, so there is no in-sample overfitting UI.
  7. Fees are always on by default.
  8. A caveat banner always appears in the result.

### 2.6 Trade-only smart-account session keys (Robinhood Chain)
**Verified platform facts [V, docs.robinhood.com/chain/account-abstraction, 2026-10-27]:** RH Chain has first-class ERC-4337 support with EntryPoint v0.6 `0x5FF137D4…2789`, v0.7 `0x0000000071727De22E5E9d8BAf0edAc6f37da032` and v0.8 `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108`, plus the Safe 4337 Module v0.3.0. It also supports EIP-7702. AA providers are Alchemy (recommended; bundler, Gas Manager, `wallet_createSession` session keys with permissions such as `contract-access` and `erc20-token-transfer`), ZeroDev, Privy and Dynamic.

**Design [A]:**
- **Account:** a modular smart account (ERC-7579-compatible, Alchemy Modular Account v2, per D3) owned by the user's own key (Privy embedded wallet or an external wallet). We prefer a dedicated smart-account address over 7702 so the trading balance stays isolated from the user's main EOA [D3].
- **Session key:** a secp256k1 key generated **inside our signer** (AWS KMS asymmetric key or a TEE-backed signer, or a Privy server-side delegated signer). The private key never exists in plaintext in app memory, logs or the DB. We store only the key ARN/id and the public address.
- **Policy (enforced on-chain by the validator/permission module, mirrored off-chain):**

| Rule | Value |
|---|---|
| Allowed targets | Uniswap Universal Router (and Permit2 approve only toward it); the 0x settler/AllowanceHolder. Exact addresses are pulled from official deployments on chain 4663 and pinned **[NOT YET VERIFIED]** |
| Allowed selectors | only the swap entrypoints of those targets (e.g. `execute(bytes,bytes[],uint256)` on the Universal Router), plus `approve(spender∈allowedTargets)` on allowlisted tokens |
| Allowed tokens | USDG/USDC + the user-selected Stock Tokens / crypto (from our pinned registry) |
| Recipient | swap output recipient must equal the smart account (decoded calldata check, or a recipient-pinning hook) |
| Native ETH transfer | **denied** · ERC-20 `transfer`/`transferFrom` to any address: **denied** |
| Per-tx cap / daily cap | user-set in USD and converted to token-unit limits at grant time; a spending-limit hook enforces them |
| Expiry | ≤ 30 days; default 7 days |
| Gas | sponsored by our Gas Manager policy limited to the allowed targets [A] |

- **Grant flow:** `POST /session-keys/prepare` → the server creates the signer key and builds the permission payload → the **owner signs** EIP-712 in their wallet → `POST /session-keys/submit` → the install is confirmed on-chain → `active`.
- **Revocation:** `DELETE /session-keys/:id` takes effect off-chain immediately (the signer refuses, active runs on that key halt with `risk_halt: session_key_revoked`). It also returns an owner-signed on-chain uninstall or permission revoke for defense in depth. Expiry is enforced on-chain even if our server is compromised.
- **Withdrawals** are owner-only actions in the user's wallet. Quiver never builds them on the server.
- **Other venues:**
  - **Solana:** a Privy-style delegated signer scoped to Jupiter swap only (as Weft does [R]). Its restriction is **provider-policy-enforced, not program-enforced**, which is weaker than EVM, and the UI must say so.
  - **Hyperliquid:** an HL "agent wallet" approved by the user via EIP-712. HL agent wallets can trade but cannot withdraw [R/A, verify against HL docs before testnet].
  - **Polymarket:** read-only, with no key at all.

### 2.7 Venue adapters
A common interface (types only, implemented later): `quote(req) → Quote`, `buildOrder(intent, quote) → UnsignedCall[]`, `submit(signed) → ref`, `status(ref) → OrderStatus`, `positions(account)`, `health()`.

| Venue | Status in v1 | Route | Notes |
|---|---|---|---|
| Robinhood Chain | paper → testnet → live | Uniswap API (v2/v3/v4, UniswapX) primary, 0x RFQ fallback [R: Uniswap blog; 0x named in RH docs] | `eth_simulateV1` / `eth_call` simulation before every send [V: method listed by Alchemy]; min-out derived from `maxSlippageBps`; deadline 60 s |
| Solana | paper → live (later phase) | Jupiter v6 quote/swap | priority fees via Helius; simulate first |
| Hyperliquid | paper → testnet → live (later phase) | HL REST/WS order API through the agent wallet | perps; leverage ≤ platform cap of 10× |
| Polymarket | **read-only** | public market/price API | signals only; validator rejects actions on `pm:` instruments (`venue_read_only`) |

Lighter perps on RH Chain are out of v1. Third-party access to it is unverified [R].

### 2.8 Oracles
- **Chainlink Data Streams** (pull, sub-second) for live evaluation of Stock Tokens and crypto. The verifier proxy is `0xcE73c8ad08CBDEaCa6078BF0627C8fe0a9a536E7` [R, not re-fetched]. We verify reports off-chain via the SDK, and on-chain only if we ever add a contract.
- **Chainlink Data Feeds** (8 decimals, update **24/5, pause during corporate actions** [R]) are used as the slower sanity reference and for daily indicators.
- **Sequencer uptime:** RH Chain is an Arbitrum Orbit L2 [V]. The plan is to read Chainlink's L2 sequencer-uptime feed if one is deployed on 4663 **[NOT VERIFIED that it exists on 4663]**. If it isn't, we watch block production via the public sequencer feed (`wss://feed.mainnet.chain.robinhood.com` [V]). Sequencer down or in its grace period means `risk_halt: oracle_sequencer_down` for RH runs.
- **Stale handling:** this falls out of `maxAgeSeconds`, giving unknown, which never fires. For equities over weekends and closures, the strategy-level `equityWhenFeedStale: "skip" | "use_pool_twap"` applies. The default is skip, because a pool TWAP while the reference market is closed can drift from fair value.

### 2.9 Indexer
It subscribes over Alchemy websocket on RH Chain to logs for the user smart accounts (Transfer, swap events, UserOperationEvent from the EntryPoint), reconciles fills (expected vs actual output), and stores tx hashes. **The chain is authoritative for balances**, and the DB stores history and cost basis. It backfills from an archive endpoint after downtime using a `last_processed_block` checkpoint and a reorg buffer of 20 blocks [A] (L2 soft-finality; final once posted to L1).

### 2.10 Keeper / scheduler
A Postgres-backed job queue (graphile-worker or pg-boss [A]) handles cycle scheduling, signal ingestion jobs per source, backtest jobs, session-key expiry sweeps, and the daily-cap reset (00:00 UTC). It is idempotent: every job has a dedupe key. A stuck run (no cycle for 3× interval) raises an alert and is re-leased.

### 2.11 Event bus
**Redis Streams**, one stream per run (`run:{id}`), with a MAXLEN of about 10k plus a durable copy in Postgres `run_events` (partitioned by month). `seq` is assigned by the producer in the run's lease holder, so it is strictly monotonic per run. The SSE gateway reads the stream and replays from Postgres when `Last-Event-ID` is older than the Redis window. The same payloads appear in `contracts/src/events.ts`.

## 3. Data model (Postgres)
```
users(id, privy_did, created_at, display_name, terms_version, deleted_at)
eligibility(user_id, ip_country, declared_country, declared_non_us, stock_tokens:allowed|blocked|unknown, checked_at, evidence jsonb)
wallets(id, user_id, chain, address, kind:embedded|external|smart_account, created_at)
instruments(id PK 'robinhood:token:0x..', venue, kind, symbol, name, asset_class, decimals, chainlink_feed, chainlink_stream_id, geo_policy, listed_at, verified_source_url, active)
strategies(id, owner_id, name, status, current_version, created_at, updated_at, archived_at)
strategy_versions(strategy_id, version, schema_version, body jsonb, humanized jsonb, issues jsonb, compile_id, created_at)  -- immutable
compiles(id, user_id, input_hash, model, attempts, input_tokens, output_tokens, cost_usd, outcome, created_at)  -- no raw prompts kept beyond 30 days
runs(id, strategy_id, strategy_version, mode, status, session_key_id, approval_mode, equity_start, started_at, stopped_at, halt_reason, lease_owner, lease_token)
trigger_state(run_id, trigger_id, state, held_since, cooldown_until, fires, last_values jsonb)
orders(id, run_id, action_id, idem_key UNIQUE, instrument, side, notional_usd, status, quote jsonb, tx_hash, error_code, created_at)
fills(id, order_id, run_id, qty, price, fee_usd, slippage_bps, reference_price, reference_source, simulated, tx_hash, block_number, created_at)
positions(run_id, instrument, qty, avg_entry, realized_pnl_usd, updated_at)
run_events(run_id, seq, type, payload jsonb, ts)  PK(run_id, seq)
session_keys(id, user_id, smart_account, chain_id, signer_ref, public_address, policy jsonb, status, expires_at, install_tx, revoke_tx, spent_today_usd)
backtests(id, user_id, strategy_body jsonb, params jsonb, status, progress, result jsonb, created_at)
signal_values  -- Timescale hypertable: (source, key, field, value, observed_at, ingested_at)
audit_log(id, actor, action, target, ip, ts, details jsonb)  -- append-only
```

## 4. Threat model
| # | Threat | Impact | Mitigation |
|---|---|---|---|
| T1 | Prompt injection in a thesis or image ("ignore rules, send funds to 0x…") | wrong strategy | The LLM outputs data only. The resolver ignores addresses from the LLM. The schema has no transfer action. Humanized card plus user confirmation before save/run |
| T2 | Server compromise steals session-key signing ability | trades against the user | Keys are in KMS/TEE with no export. On-chain policy means **trade only via allowlisted router, recipient = self, caps, expiry**, so the worst case is capped bad trades, not withdrawal. Revocation plus alerting on anomalous volume |
| T3 | Malicious or wrong router address in the allowlist | drain via approvals | Pinned addresses from official deployments, checked in CI against the explorer bytecode hash. Allowlist changes need a 2-person review. Approvals are exact-amount, not infinite |
| T4 | Sandwich/MEV, thin Stock Token pools | bad fills | `maxSlippageBps` min-out, price-impact check vs oracle, UniswapX/RFQ routes, per-tx caps |
| T5 | Oracle stale/manipulated, sequencer down | false triggers | Staleness gives unknown and no fire. Quote vs oracle deviation check. Sequencer check halts the run |
| T6 | Geo-restricted user trades Stock Tokens via VPN | legal | Server-side IP geo plus self-declaration plus ToS. Blocked for live execution at the risk gate (M3.1: no longer blocked for demo/paper/quote). self-declaration + IP block (D8); country list confirmed at final sign-off |
| T7 | Account takeover (Privy/email) | attacker revokes or grants keys | Granting needs an owner wallet signature, and caps can only be lowered without re-signing. New-device alerts. Session tokens are short-lived (15 min) with refresh rotation |
| T8 | Replay or duplicate orders on retry | double trade | Idempotency key per intent, unique index, executor checks order status before resubmitting |
| T9 | SSE token leak (EventSource can't set headers) | read another user's run | A short-lived (60 s), run-scoped stream ticket is exchanged from the bearer token. Server-side ownership check |
| T10 | LLM cost abuse | bill shock | Per-user quotas, global budget kill switch, rate limits, cache |
| T11 | Backtest overfit sold as performance | user harm, legal | Caveats, no "expected return" copy, next-bar fills, fees on |
| T12 | Insider or admin misuse | funds | There is no admin key that can move user funds. Admin can only halt runs (kill switch), and every admin action is audit-logged |
| T14 | Leaked session key fills the 64-entry spend log with dust swaps (self-DoS for 24 h) | session unusable until the window rolls | **M3.6:** min notional per swap `ceil(windowCap/64)` and `windowCap <= 64 × perTxCap` at grant, so 64 entries always sum to at least the cap: the attacker can only do what the cap already allows (spend it). Revoke + re-grant to a new key restores service |
| T15 | Sandwich within the oracle floor | up to `maxSlippageBps` of each swap | **M3.6:** `slippageCapBps` default 100 (1%), so the worst case is ≈1% of `windowCap` per 24 h per key; raising it needs an explicit owner `setSlippageCap` (≤ 10%). App strategies default to 50 bps |
| T16 | Stale/incomplete oracle round or L2 sequencer outage | wrong floor | **M3.6:** `setFeed` maxAge bounded 60 s–24 h; `answeredInRound >= roundId`, `updatedAt != 0`; optional sequencer uptime feed with grace period; all fail closed |
| T13 | Dependency/supply chain | key theft | Lockfile, `npm audit` in CI, minimal signer service with its own tiny dependency set |

## 5. Geo-restriction compliance (Stock Tokens)
Facts [R, from docs.robinhood.com/chain/stock-tokens via the teardown]: Stock Tokens are **not available to US persons**, and are restricted in **CA, UK, CH, UAE**. Secondary trading is 24/7, and minting runs Mon 02:00 – Sat 02:00 CET. **What Robinhood requires of third-party dapps is unverified.**
Our controls [D8; country list confirmed at final sign-off]:
1. **Eligibility record:** server-side IP country (a MaxMind-class database), plus a **self-declaration** ("I am not a US person; country of residence = X"), plus acceptance of a ToS version. All three are stored with evidence.
2. **Policy table** `geo_policy` per instrument (Stock Tokens = deny US, CA, GB, CH, AE, plus any additions from legal). It is configurable without a deploy.
3. **Enforcement points:**
   - `GET /markets` shows `geoRestricted: true, tradable: false`, so tokens stay visible but cannot be traded;
   - the validator raises `geo_restricted` issues;
   - the risk gate re-checks on every order using the current IP;
   - the quote endpoint returns 451.
   - Paper mode enforces the same rules.
4. **VPN/hosting-ASN detection** marks eligibility `unknown`, which blocks equities.
5. **Crypto, Hyperliquid and Polymarket signals** carry their own regional rules (Polymarket and Hyperliquid have their own restrictions) and are covered by the same `GEO_BLOCKED_COUNTRIES` mechanism. A per-venue list is configurable, and the country list is confirmed at final sign-off.

## 6. Failure modes
| If… | Then… |
|---|---|
| A run worker dies | Its lease expires (45 s) and another worker resumes from `trigger_state`. Idempotency keys prevent double orders |
| The scheduler stops | No cycles run. The watchdog alerts after 3× the interval, the UI shows "Paused: engine delayed" via missing heartbeats, and no trades fire (fail-closed) |
| An oracle or data source is down | The signals go stale → unknown → no fire. `warning` events are published. Runs referencing only that source show "waiting for data" |
| The RH Chain sequencer is down | RH runs halt (`risk_halt`). Other venues continue |
| The Uniswap API is down | The 0x fallback is used. If both are down: `error: venue_unavailable, retryable`, with retries ×3 under backoff inside the intent's validity window (60 s). After that the intent expires and the run continues |
| Partial multi-leg fill (a1 filled, a2 failed) | No automatic unwind in v1. An `error` event is emitted with a clear message, and the user decides. Atomic multi-venue execution is impossible across chains |
| A session key expires or a cap is hit | `risk_halt` (session_key_expired / session_key_cap). The run pauses with a renewal prompt |
| The LLM provider is down | Compile returns `compile_failed`. Existing runs are unaffected because the engine doesn't depend on the LLM |
| Postgres is down | The API returns 503 and workers stop issuing intents (state can't be persisted, so fail-closed) |
| Redis is down | SSE degrades to polling `GET /runs/:id/events?since=` from Postgres. The engine keeps writing to Postgres |
| The signer/KMS is unavailable | Live orders fail closed with `error`, and paper is unaffected |

## 7. Observability
- **Logs:** pino JSON with `requestId`, `runId`, `orderId` and `userId` (hashed). Secrets, keys, tokens and full prompts are never logged.
- **Metrics (OpenTelemetry → Prometheus/Grafana):**
  - cycle lag p50/p99;
  - signal staleness per source;
  - triggers fired per minute;
  - intent → fill latency;
  - slippage realized vs quoted;
  - reject reasons;
  - compile attempts, repair rate, cost per day;
  - SSE connections;
  - session keys active and spent vs cap.
- **Traces:** one trace per cycle, with child spans for signal read → evaluate → risk → quote → sign → submit → confirm.
- **Alerts:**
  - cycle lag > 60 s;
  - any live order stuck > 2 min;
  - slippage > cap (should be impossible);
  - LLM spend > 80% of budget;
  - signer error rate;
  - geo-block spikes;
  - indexer behind > 50 blocks.
- **User-facing:** a `/v1/status` endpoint plus per-venue health, matching the web shell's online dot.

## 8. Phased plan
| Phase | Scope | Exit gate |
|---|---|---|
| **P0 Contracts** (this doc) | schemas, API, mocks, config | schemas compile; fixtures validate (autonomous) |
| **P1 Paper** | compiler, engine, simulator, SSE, backtester (crypto + Hyperliquid data), RH Chain read-only (quotes + Chainlink), Polymarket signals | paper runs stable for 7 days; Robin QA |
| **P2 Testnet** | verification tasks V1–V11 (§10); RH Chain testnet 46630: smart account, session-key grant/revoke, Uniswap/0x execution (if deployed on testnet **[NOT VERIFIED]**), indexer reconciliation; HL testnet | Foundry/Anvil fork tests of policy (transfer denied, cap enforced, expiry), external review of the session-key policy |
| **P3 Mainnet (gated)** | chain 4663 behind waitlist, $1,000/day cap | Final user sign-off (§9): addresses, geo list, `QUIVR_MAINNET_ENABLED=true` |
| P4 | Solana/Jupiter live, HL live, more signals | per-venue approval |

## 9. Decided defaults (we proceed with these; each is configurable)
Status changed on 2026-10-27: the build is fully autonomous, with no mid-way questions. Each default below maps to a config key in §11.

| # | Topic | Decided default | Config key |
|---|---|---|---|
| D1 | Quiver fee | **30 bps (0.30%)** on executed notional, taken in the input token inside the same batched UserOp and sent to `QUIVR_FEE_ROUTER`. Paper mode shows the fee and charges nothing | `QUIVR_FEE_BPS` (0–100, hard max 100) |
| D2 | AI provider | **OpenRouter**, using a structured-output-capable model. Global cap **$50/day**; per user 30 compiles/day; per call ≤3 attempts | `OPENROUTER_API_KEY`, `LLM_MODEL`, `LLM_DAILY_BUDGET_USD`, `LLM_USER_DAILY_COMPILES` |
| D3 | Smart account | A **dedicated Alchemy Modular Account (v2)** per user via Alchemy Wallet APIs, not 7702 on the user's EOA | `AA_PROVIDER=alchemy`, `ALCHEMY_API_KEY` |
| D4 | Session-key defaults | Expiry **24 h** (max 168 h, M3.9), **$250 per tx**, **$1,000 per day**. Users can lower these, never raise them past the platform max | `SK_DEFAULT_EXPIRY_HOURS`, `SK_MAX_EXPIRY_HOURS`, `SK_DEFAULT_PER_TX_USD`, `SK_DEFAULT_DAILY_USD` |
| D5 | Gas | **No sponsorship by default.** The user's smart account pays ETH gas. With the flag on, an Alchemy Gas Manager policy limited to the allowlisted targets pays instead | `GAS_SPONSORSHIP_ENABLED=false`, `ALCHEMY_GAS_POLICY_ID` |
| D6 | Multi-leg failure | **Leave it and alert.** No auto-unwind. An `error` event, a notification and a portfolio banner listing the open leg | `MULTILEG_FAILURE_POLICY=leave_and_alert` |
| D7 | Backtest data | **Free sources only:** Hyperliquid public candles and funding; RH Chain on-chain pool swaps and Chainlink round history via the indexer; Polymarket public price history. Stock history from before Stock Tokens were listed is **modeled** from a free daily end-of-day equity source, labeled `synthetic: true` / "Modeled" in the UI. A paid vendor plugs in later | `BACKTEST_EQUITY_SOURCE=free_eod`, `DATA_VENDOR_API_KEY` (optional) |
| D8 | Geo / eligibility | **Self-declaration ("not a US person" plus country of residence) plus server-side IP block** for restricted regions. VPN/hosting traffic counts as `unknown` and is blocked for equities. Default list: `US,CA,GB,CH,AE` (from the RH Stock Token docs [R]) | `GEO_BLOCKED_COUNTRIES`, `GEO_IP_DB_PATH`, `TERMS_VERSION` |
| D9 | LLM vendor lock | Provider-agnostic interface. OpenRouter is the only adapter in v1 | `LLM_PROVIDER=openrouter` |
| D10 | Mainnet caps | Global per-user daily cap **$1,000** plus a waitlist allowlist while mainnet is new | `MAINNET_USER_DAILY_CAP_USD`, `MAINNET_ALLOWLIST_ONLY=true` |
| D11 | $QUIVR token | **Not part of the app build.** The app runs without a token. Fees accrue to the treasury. Token launch is a final sign-off item | `QUIVR_TOKEN_ADDRESS` (optional) |

### Final user sign-off at the end (the only irreducible items)
1. **Wallet addresses:** `QUIVR_TREASURY`, `QUIVR_FEE_ROUTER` destination, and the `QUIVR_DEPLOYER` public address.
2. **Legal/geo:** confirm the `GEO_BLOCKED_COUNTRIES` list and the terms text.
3. **Mainnet go-live:** set `QUIVR_MAINNET_ENABLED=true` after testnet verification passes.
4. **Token launch:** whether, when and how $QUIVR launches.

## 10. Verification build tasks (testnet phase, P2; no questions, these are tasks)
Each task writes its result to `backend/config/verified/<chainId>.json` with `{ value, sourceUrl, checkedAt, method, bytecodeHash }`. The app refuses to load any allowlisted address without a verified entry, so it fails closed. CI re-runs the checks.

| ID | Task | Method | Pass condition |
|---|---|---|---|
| V1 | Uniswap Universal Router, Permit2, Quoter on 46630 / 4663 | Read the official Uniswap deployments list and the RH docs → `eth_getCode` on each chain → compare against the canonical bytecode hash | code present + hash match + source URL recorded |
| V2 | Uniswap API serves 46630? | A test quote call with the testnet chain ID | 200 with a route. If not, testnet routes via direct v3/v4 pool calls (adapter flag `UNISWAP_ROUTE_MODE=api|onchain`) |
| V3 | 0x AllowanceHolder/Settler on 4663 | 0x docs plus `eth_getCode` | as V1. If absent, the 0x fallback is disabled |
| V4 | Stock Token registry (testnet + mainnet) | RH docs token page (retry; 404 earlier), Blockscout token search, verified-contract check, `symbol()`/`decimals()==18`/ERC-8056 `uiMultiplier()` calls | Each token is listed in `instruments` with `verified_source_url`. Unverified tokens never become tradable |
| V5 | Chainlink feed and stream IDs per stock | Chainlink data.chain.link for RH Chain plus an on-chain `latestRoundData()` / `decimals()==8` | fresh round within the expected heartbeat |
| V6 | Data Streams verifier proxy `0xcE73…36E7` | `eth_getCode` + Chainlink docs | code present |
| V7 | L2 sequencer-uptime feed on 4663 | Chainlink docs + on-chain read | Present: use it. Absent: use the block-production watchdog on the sequencer feed (already designed) |
| V8 | Alchemy session-key permissions enforce the policy | Foundry/Anvil fork tests plus live testnet UserOps: transfer → revert, non-allowlisted target → revert, over cap → revert, expired → revert, recipient ≠ self → revert, revoke → revert | all negative tests revert, positive swap succeeds |
| V9 | Hyperliquid agent wallet cannot withdraw | HL docs + an HL testnet attempt to withdraw with the agent key | rejected |
| V10 | Pool depth per Stock Token | Uniswap quotes at $250 / $1,000 / $5,000 | Price impact ≤ `maxPriceImpactBps`. Otherwise the per-token cap is lowered automatically |
| V11 | Free equity EOD source and Polymarket API terms | Read the terms. Record the URL | allowed for our use. Otherwise switch source or disable that signal |

## 11. User-supplied config (placeholders)
The app **boots on mock or testnet with every placeholder unset where possible**:
- missing keys degrade to mocks;
- missing addresses disable the features that need them.

On **mainnet** (`QUIVR_MAINNET_ENABLED=true` and `CHAIN_ID=4663`), startup **fails closed**: the process exits non-zero, listing each missing or invalid "mainnet-required" key. Validation runs through `contracts/src/config.ts` (zod). The template is in `backend/.env.example`.

| Name | Purpose | Format | Required for | Default / mock behaviour when unset |
|---|---|---|---|---|
| `QUIVR_MODE` | Runtime mode | `mock\|testnet\|mainnet` | all | `mock` |
| `CHAIN_ID` | Robinhood Chain | `46630` or `4663` | testnet, mainnet | `46630` |
| `QUIVR_MAINNET_ENABLED` | Master switch for real-money execution | `true\|false` | mainnet | `false`. Live runs return `mode_not_enabled` |
| `QUIVR_TREASURY` | Treasury receiving protocol fees | EVM address (checksummed) | mainnet | testnet: fees are computed and logged but not charged; mock: n/a |
| `QUIVR_FEE_ROUTER` | Address the fee transfer in each batched UserOp goes to (EOA or splitter contract) | EVM address | mainnet | defaults to `QUIVR_TREASURY` if set; otherwise fee leg skipped (testnet) |
| `QUIVR_DEPLOYER` | Public address of the deployer of any Quiver contracts (fee splitter). **Public address only; the key is never in env** | EVM address | mainnet (if contracts deployed) | testnet: Foundry uses a throwaway Anvil/testnet key from the local keystore |
| `QUIVR_FEE_BPS` | Protocol fee | integer 0–100 | mainnet | `30` (paper shows it, charges 0) |
| `QUIVR_TOKEN_ADDRESS` | $QUIVR token, if launched | EVM address | optional | features that need the token are hidden |
| `ALCHEMY_API_KEY` | RPC, bundler, Wallet APIs, session keys | string | testnet, mainnet | mock: in-memory fake smart account; testnet without key: public RPC read-only, session keys disabled |
| `AA_PROVIDER` | Smart-account provider | `alchemy` | testnet, mainnet | `alchemy` |
| `ALCHEMY_GAS_POLICY_ID` | Gas Manager policy | string | only if sponsorship on | unset → sponsorship off |
| `GAS_SPONSORSHIP_ENABLED` | Pay user gas | `true\|false` | — | `false` |
| `SIGNER_BACKEND` | Where session keys live | `kms\|privy\|local_dev` | testnet, mainnet | `local_dev` (encrypted local keystore, **refused when mainnet**) |
| `KMS_KEY_RING` / `AWS_REGION` | KMS location for session keys | string | mainnet | — (mainnet fails closed if `SIGNER_BACKEND≠kms\|privy`) |
| `OPENROUTER_API_KEY` | LLM compile | string | testnet, mainnet (feature) | unset → compile serves the fixture-based mock compiler, labeled "Demo compile" |
| `LLM_MODEL` | OpenRouter model id | string | — | a structured-output model chosen in config |
| `LLM_DAILY_BUDGET_USD` | Global AI spend cap | number | — | `50` |
| `LLM_USER_DAILY_COMPILES` | Per-user quota | int | — | `30` |
| `DATA_VENDOR_API_KEY` | Optional paid market-data vendor | string | optional | unset → free sources plus "Modeled" label |
| `BACKTEST_EQUITY_SOURCE` | Pre-listing stock history | `free_eod\|vendor\|none` | — | `free_eod` |
| `CHAINLINK_STREAMS_CLIENT_ID` / `CHAINLINK_STREAMS_SECRET` | Data Streams access (credentials issued by Chainlink) | string | mainnet (equity triggers) | unset → Data Feeds only (slower; `source: chainlink_feed`) |
| `HL_NETWORK` | Hyperliquid network | `testnet\|mainnet` | — | `testnet` |
| `GEO_BLOCKED_COUNTRIES` | Restricted regions for Stock Tokens | ISO-3166 CSV | all | `US,CA,GB,CH,AE` |
| `GEO_IP_DB_PATH` | IP-country database file | path | mainnet | unset on mainnet → **fail closed** (equities blocked for all); testnet/mock: country `unknown`, declaration-only |
| `TERMS_VERSION` | ToS version users accept | string | mainnet | `draft-0` (mainnet refuses `draft-*`) |
| `PINATA_JWT` | IPFS pinning for result cards/films and token metadata (only if a token launches) | JWT | optional | unset → images served from our own storage. Not needed for core app |
| `DATABASE_URL` | Postgres | URL | testnet, mainnet | mock: embedded pglite |
| `REDIS_URL` | Event bus | URL | testnet, mainnet | mock: in-process bus |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | Login | string | testnet, mainnet | mock: dev login with a fixed demo user |
| `SK_DEFAULT_EXPIRY_HOURS` / `SK_MAX_EXPIRY_HOURS` | Session-key expiry (hours; M3.9) | int | — | `24` / `168` |
| `SK_DEFAULT_PER_TX_USD` / `SK_DEFAULT_DAILY_USD` | Session-key caps | number | — | `250` / `1000` |
| `MAINNET_USER_DAILY_CAP_USD` | Platform per-user cap | number | mainnet | `1000` |
| `MAINNET_ALLOWLIST_ONLY` | Waitlist gate | `true\|false` | mainnet | `true` |
| `MULTILEG_FAILURE_POLICY` | Partial-fill policy | `leave_and_alert` | — | `leave_and_alert` |
| `UNISWAP_API_KEY` | Uniswap Trading API | string | testnet, mainnet | unset → on-chain quoter route (`UNISWAP_ROUTE_MODE=onchain`) |
| `ZEROX_API_KEY` | 0x fallback | string | optional | unset → fallback disabled |

**Mainnet fail-closed rule:** these must all be set and valid, or the process exits:
- `QUIVR_TREASURY`, `QUIVR_FEE_ROUTER` (or treasury), `QUIVR_FEE_BPS`;
- `ALCHEMY_API_KEY`, `SIGNER_BACKEND∈{kms,privy}`;
- `DATABASE_URL`, `REDIS_URL`, `PRIVY_*`, `GEO_IP_DB_PATH`;
- `TERMS_VERSION` not `draft-*`;
- `OPENROUTER_API_KEY`;
- every verified-address entry from §10.

Facts verified this session [V]: chain IDs 4663/46630, ETH gas, Arbitrum L2, public RPC and sequencer-feed URLs, explorers, Alchemy as the recommended provider, ERC-4337 EntryPoint v0.6/v0.7/v0.8 addresses, EIP-7702 support, AA providers (Alchemy, ZeroDev, Privy, Dynamic), Alchemy session keys (`wallet_createSession`), and `eth_simulateV1` via Alchemy. Everything else listed in §10 is verified by build tasks.

Sources: https://docs.robinhood.com/chain/connecting/ , https://docs.robinhood.com/chain/account-abstraction/ , https://www.alchemy.com/docs/wallets/reference/wallet-apis-session-keys/api.md , https://www.alchemy.com/docs/robinhood-chain/robinhood-chain-api-overview.md
- See VERIFICATION.md for mainnet-readonly price mode and the fail-closed testnet block (M2).

## M3 notes
- Engine: one shared wave timer (RunManager.runWave); all runs evaluated at the same t, `ENGINE_CONCURRENCY` limit, per-wave MemoMarket read cache, overrun/in-flight skip. 1000 mock runs per wave measured well under the 15 s cycle (test asserts <5 s).
- Costs model: src/sim/costs.ts (assumptions). Metrics: src/backtest/metrics.ts. Calendar: src/venues/calendar.ts (NYSE 2025–2027, verified nyse.com 2026-10-27).
- History: Chainlink rounds back to 2026-06-22 (retries, gap counting, outlier filter); optional Tiingo "Modeled" EOD before that.
