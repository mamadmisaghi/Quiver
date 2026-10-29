# Quiver ($QUIVR) — final user sign-off list

Status 2026-10-27 (M3, updated M3.6). Nothing below is done on mainnet, no real funds, no token. Each line needs an explicit yes/no or value from Gofi.
Items marked **[UNVERIFIED]** were not confirmed by us.

## 1. Wallet placeholders (public addresses only — never send private keys)
- [ ] `QUIVR_TREASURY` — receives protocol fees (mainnet required). Recommend a multisig (e.g. Safe) — Safe deployment on 4663 **[UNVERIFIED]**.
- [ ] `QUIVR_FEE_ROUTER` — fee destination (defaults to treasury).
- [ ] `QUIVR_DEPLOYER` — public address of the deployer; key stays in a hardware wallet/KMS.
- [ ] `SIGNER_BACKEND` = kms or privy for session keys (`local_dev` is refused on mainnet); `KMS_KEY_RING`, `AWS_REGION` if kms.
- [ ] `QUIVR_TOKEN_ADDRESS` — only if a token is launched (see §8).

## 2. API keys (server-side env only; never in the web bundle)
| Env | Needed for | Where to get it | Without it |
|---|---|---|---|
| `ALCHEMY_API_KEY` (+ `ALCHEMY_GAS_POLICY_ID` if sponsoring gas) | RPC, bundler, smart accounts | https://dashboard.alchemy.com | mainnet refuses to start |
| `UNISWAP_API_KEY` | Robinhood Chain swap quotes/routes | https://developers.uniswap.org (Uniswap Labs developer portal) | on-chain quoter fallback |
| `ZEROX_API_KEY` | 0x routing fallback on 4663 | https://dashboard.0x.org | 0x fallback disabled |
| `OPENROUTER_API_KEY` | strategy compiler LLM | https://openrouter.ai/keys | mock "Demo compile" |
| `TIINGO_API_KEY` (optional) | "Modeled" EOD history before Jun 22 2026 | https://www.tiingo.com (account → API token) | backtests start at first Chainlink round; see V11 licence note |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | user login | https://dashboard.privy.io | dev login only (refused on mainnet) |
| `CHAINLINK_STREAMS_CLIENT_ID/SECRET` (optional) | low-latency Data Streams | Chainlink sales/Data Streams onboarding | Data Feeds only |
| `PINATA_JWT` (optional) | result cards / metadata | https://app.pinata.cloud | feature off |
| Infra: `DATABASE_URL`, `REDIS_URL`, `GEO_IP_DB_PATH` (e.g. MaxMind GeoLite2 — licence **[UNVERIFIED]**), `QUIVR_JWT_SECRET` (≥32 chars) | | your hosting | mainnet refuses to start |

## 3. Faucet ETH (testnet 46630)
- [ ] Testnet ETH from https://faucets.chain.link/robinhood-testnet — wallet-connect UI, no HTTP API; needs a human with a throwaway testnet wallet. Not required while M3 runs on mainnet-readonly + local anvil (no testnet pool deploy, per Gofi).

## 4. V11 terms findings (full table: VERIFICATION.md §V11 — restrictions only, not legal advice)
- [ ] Stock Tokens: not for US persons; restricted in CA, GB, CH, AE, sanctioned countries; issuer list is authoritative and can change. Mint/burn window Mon–Sat 02:00 CET.
- [ ] Chainlink: ToS acceptance; developer responsible for feed quality/staleness checks.
- [ ] Uniswap API: end users must accept Uniswap terms (or equivalent); sanctions reps; fees may be added.
- [ ] 0x API: no redistribution/storage of 0x data outside the app; keys server-side; no load testing without consent.
- [ ] Hyperliquid: not for US/Ontario/sanctioned persons; optional per-wallet `legalCheck` gate (not yet wired — want it?).
- [ ] Polymarket: terms not readable from our network → keep mock-only, or have someone outside the US read https://polymarket.com/tos.
- [ ] Tiingo: internal use only on free/Individual plans; user-facing modeled data needs a Commercial/redistribution licence. Keep off?
- [ ] Recommend counsel review before mainnet.

## 5. Geo list
- [ ] `GEO_BLOCKED_COUNTRIES` default `US,CA,GB,CH,AE` (from Stock Token restrictions). Add sanctioned countries (e.g. CU,IR,KP,SY,RU,BY + others on the issuer list **[UNVERIFIED]**)? Hyperliquid additionally excludes Ontario (province-level; our IP DB gate is country-level → block all CA, already in list).

## 6. Fee
- [ ] `QUIVR_FEE_BPS` = 30 (0.30%) default, max 100. Charged on Robinhood Chain fills; backtests/paper apply 30 bps + modeled gas/spread/impact (sim/costs.ts, labelled assumptions). Confirm rate and whether HL/Solana legs also pay it.

## 7. Mainnet go-live (all must be true)
- [ ] `QUIVR_MAINNET_ENABLED=true` set by you only; `MAINNET_ALLOWLIST_ONLY=true` and `MAINNET_USER_DAILY_CAP_USD=1000` for the first phase?
- [ ] Session-key defaults: expiry 7d (max 30d), $250/tx, $1000/day.
- [ ] M3.6 on-chain policy defaults: `slippageCapBps` = 100 (1%; raise only via owner `setSlippageCap`, ≤ 10%), feed `maxAge` 60 s–24 h, minimum swap = windowCap/64 (with $250/tx and $1000/day that is $15.63), L2 sequencer uptime feed address on 4663 **[UNVERIFIED — none found, V7]**.
- [ ] External review of the session-key policy contracts; Uniswap/0x addresses verified on 4663 (V1–V3 currently fail-closed).
- [ ] `TERMS_VERSION` final (draft-* refused), `DEV_LOGIN_ENABLED=false`.
- [ ] Multi-leg failure policy `leave_and_alert`.

## 8. Token
- [ ] $QUIVR launch: **not done, not planned by Sage.** Decide yes/no, venue, and whether it touches fees. No contract deployed; `QUIVR_TOKEN_ADDRESS` unset.

## 9. Final env and key list (M5, 2026-10-28)
These are server-side env values only, never put in the web bundle. Every value is an empty placeholder in `.env.example`; real values go only into the VPS env.
Who provides each one: **Gofi** owns accounts and keys from third parties. **Robin** is the operator: generates random secrets and sets VPS env.
"Required" means required for the public testnet launch (QUIVR_MODE=testnet). Mainnet stays gated (§7).

| Env | What it is | Who | Req? |
|---|---|---|---|
| `QUIVR_MODE` | `mock` \| `testnet` (mainnet gated by §7) | Robin | **required** (`testnet`) |
| `QUIVR_JWT_SECRET` | signs Quiver access tokens, ≥32 random chars (`openssl rand -hex 32`). Rotating it signs everyone out | Robin | **required** outside mock (boot refuses) |
| `PRIVY_APP_ID` | Privy app id (dashboard.privy.io → app settings) | Gofi | **required** for real login (else dev login only, refused outside mock) |
| `PRIVY_APP_SECRET` | Privy app secret (same page). Server only | Gofi | **required** with the app ID (mainnet boot check) |
| `PRIVY_VERIFICATION_KEY` / `PRIVY_JWKS_URL` | Privy's public verification key (PEM) or JWKS URL for checking ID tokens offline | Gofi (copy from dashboard) | optional (one of them recommended; unset = Privy JWKS fetched from auth.privy.io for the app ID) |
| `SIWE_ORIGIN` | exact web origin for wallet-link SIWE messages, e.g. `https://app.quiver.xyz` (scheme://host[:port], no path) | Robin | **required** for wallet linking (without it the feature is off, `walletLink.enabled:false`) |
| `SIWE_DEV_LOCALHOST` | dev fallback to http://localhost:3000; ignored outside mock | — | leave unset |
| `CORS_ORIGINS` | comma-separated exact web origins, no wildcards | Robin | **required** (the default is localhost only) |
| `TRUST_PROXY` | `true` **only when the API is reachable solely through Caddy on the same host** (Caddy overwrites X-Forwarded-For; verified live in the M5.20 gate). Never set it if the API port is exposed directly or behind a proxy that appends XFF: the first XFF entry is used as the client IP for rate limits, so a spoofed header would bypass them. Keep the API bound to 127.0.0.1 / firewalled | Robin | optional (`true` on the VPS behind Caddy) |
| `TRUST_PROXY_PEERS` | M5.21: `loopback` (default) = XFF is honoured only when the TCP peer is 127.0.0.0/8 or ::1 (Caddy on this host); direct non-loopback callers are limited by their socket IP. `any` = old behaviour | Robin | leave default |
| `INTERNAL_PROXY_TOKEN` | M5.21: shared secret for the web server's server-side calls (e.g. /u/:handle profile pages). The web sends it as header `X-Quiver-Internal-Token`; the API accepts it only from a loopback peer, compares it in constant time, and gives those calls their own bucket (20× the public per-IP limit, e.g. 1200/min for profiles). Wrong/missing token or non-loopback peer = normal per-IP limit. ≥32 random chars (`openssl rand -hex 32`); set the **same value** in the API env and the web server env (server-only, never `NEXT_PUBLIC_*`). Recommended Caddy line on the public site: `request_header -X-Quiver-Internal-Token` | Robin | optional (recommended) |
| `WARMUP_MAX_MS` | M5.21: cap for the background price-history load after the server starts listening (default 30000). While loading, `/v1/health` returns `ready:false`, `warmup.state:"warming"`; history/backtests use loaded data with a warm-up notice | Robin | optional |
| `OPS_TOKEN` | bearer for `/v1/ops/*` (shutdown, stop runs), ≥32 random chars (`openssl rand -hex 32`) | Robin | optional (unset = ops routes off) |
| `OPENROUTER_API_KEY` | LLM for the strategy compiler / instruct (openrouter.ai/keys). Set a spend limit on the key | Gofi | optional (unset = mock "Demo compile") |
| `LLM_MODEL` | text model id on OpenRouter | Gofi | optional (built-in default) |
| `LLM_VISION_MODEL` | vision-capable model for chart-screenshot compile, e.g. `openai/gpt-4o-mini` | Gofi | optional (needed for image compile) |
| `LLM_DAILY_BUDGET_USD` (50), `LLM_EST_CALL_USD` (0.5, floor), `LLM_MAX_OUTPUT_TOKENS` (4000), `LLM_MAX_INPUT_TOKENS` (16000), `LLM_PRICE_IN_PER_MTOK` / `LLM_PRICE_OUT_PER_MTOK`, `LLM_MAX_INFLIGHT` (4), `LLM_USER_DAILY_COMPILES` (30) | LLM spend caps: a global daily USD budget, per-call estimate, token bounds, model price, concurrency, and per-user daily quota. Calls made with a user's own AI key still count toward these caps and quotas (conservative) | Gofi decides values; Robin sets them | optional (safe defaults) |
| `SECRETS_MASTER_KEY` | 32-byte key encrypting users' stored RPC URLs / AI keys (AES-256-GCM, HKDF-derived). Generate: `openssl rand -hex 32` (64 hex) or `openssl rand -base64 32`. Store it like a password; never commit it | Robin | optional (unset = "own RPC / AI key" returns 503 `secrets_unavailable`) |
| ↳ rotating it | There is no re-encryption. With a new key, every stored user secret fails to decrypt and is treated as **not set**: users fall back to the server RPC / AI key and must re-enter theirs. Nothing crashes and no plaintext is exposed. Losing the key has the same effect | | |
| `ALCHEMY_API_KEY` | Alchemy RPC / bundler / smart accounts (dashboard.alchemy.com) | Gofi | optional on testnet (public RPC fallback); **required** for mainnet |
| `ALCHEMY_GAS_POLICY_ID` + `GAS_SPONSORSHIP_ENABLED` | Gas Manager policy id, if Quiver sponsors user gas. Set spend and per-user limits on the policy in Alchemy | Gofi | optional (required if sponsorship is on; boot check) |
| `CHAIN_READS_ENABLED` | `true` turns on read-only testnet (46630) chain reads (accounts, balances, session-key status) | Robin | optional (default false) |
| `TESTNET_RPC_URL` | RPC for 46630 reads (Alchemy URL or public RPC) | Gofi/Robin | required if `CHAIN_READS_ENABLED=true` |
| `CHAIN_READ_TIMEOUT_MS`, `TESTNET_SESSION_ACCOUNT_CODEHASH` | read timeout; expected SessionAccount code hash (from our testnet deploy) | Robin | optional |
| `TELEGRAM_BOT_TOKEN` | BotFather token for Telegram alerts. Users must /start the bot first | Gofi | optional (unset = channel `not_configured`) |
| `X_ALERTS_TOKEN` | X API OAuth2 user token with `dm.write` (+ `users.read`) for the account that sends alert DMs. Recipients must accept DMs | Gofi | optional (unset = `not_configured`) |
| `REPLAY_RENDERER` | `stub` (no video) or `ffmpeg` (local encode) | Robin | optional (default stub) |
| `FFMPEG_PATH` | full path to ffmpeg. **Windows VPS:** install with `winget install Gyan.FFmpeg` (or unzip a build from gyan.dev / BtbN to `C:\ffmpeg`), check `ffmpeg -encoders` lists `libx264`, then set `FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe` (full path; the renderer runs it with an empty env, so PATH lookup is not used). **M5.20:** config refuses a relative path or one containing `..` (boot fails) | Robin | required if `REPLAY_RENDERER=ffmpeg` |
| `REPLAY_RENDER_DIR`, `REPLAY_RENDER_MAX_SEC` (90), `REPLAY_RENDER_MAX_BYTES` (20 MB), `REPLAY_RENDER_MAX_QUEUE` (20) | output folder (keep it outside the web root; the API serves the files) and caps | Robin | optional |
| `DATABASE_URL`, `REDIS_URL` | persistence (Postgres / Redis) | Robin | required for mainnet; testnet can use the in-memory store |
| `GEO_BLOCKED_COUNTRIES`, `GEO_IP_DB_PATH`, `TERMS_VERSION` | geo block list (§5), IP database path, current terms version | Gofi (policy) / Robin | recommended |
| `TIINGO_API_KEY` | M5.18 Tiingo history for stock/ETF market charts and backtests (daily bars; IEX intraday for 15m/1h/4h). Unset or any Tiingo error = current source, `dataSource: "fallback"`. Free tier ≈ 50 req/h; client caps at 45/h with a 15-min cache; M5.20: each user gets at most 15 network calls/h of that budget (cache hits are free; over the cap = fallback). Keep empty until Gofi provides it | Gofi | optional |
| `UNISWAP_API_KEY`, `ZEROX_API_KEY`, `DATA_VENDOR_API_KEY`, `CHAINLINK_STREAMS_CLIENT_ID`, `PINATA_JWT` | quotes, routing, history and metadata (see §2) | Gofi | optional |
| `ALERTS_PROVIDER`, `ALERTS_EMAIL_API_KEY` | webhook/email alerts (email unused for now) | — | optional |
| `QUIVR_MAINNET_ENABLED`, `QUIVR_TREASURY`, `QUIVR_FEE_ROUTER`, `QUIVR_DEPLOYER`, `QUIVR_FEE_BPS`, `QUIVR_TOKEN_ADDRESS`, `SIGNER_BACKEND`, `KMS_KEY_RING`, `MAINNET_*` | mainnet only, **deferred**: leave unset/false | Gofi at go-live | not for testnet |
| `CHAIN_ID` | `46630` testnet (default) or `4663` mainnet (mainnet gated by §7) | Robin | optional (leave default on testnet) |
| `NODE_ENV` | `production` on the VPS; refuses `DEV_LOGIN_ENABLED` | Robin | recommended (`production`) |
| `RPC_URL` | optional RPC override for `CHAIN_ID` (else public RPC; Alchemy if `ALCHEMY_API_KEY`) | Gofi/Robin | optional |
| `AA_PROVIDER` | smart-account provider; only `alchemy` is accepted | — | leave unset (default) |
| `LLM_PROVIDER` | LLM provider; only `openrouter` is accepted | — | leave unset (default) |
| `VERIFIED_READONLY_PATH` | path to the verified read-only contract list (default `config/verified/4663-readonly.json`) | Robin | leave default |
| `PRIVY_VERIFICATION_KEY` | (listed with `PRIVY_JWKS_URL` above) ES256 SPKI PEM, `\n`-escaped | Gofi | optional |
| `PRIVY_JWKS_URL` | (listed above) JWKS override URL | Gofi | optional |
| `TESTNET_SESSION_ACCOUNT_CODEHASH` | (listed above) 0x + 64 hex; unset = code check "unchecked" | Robin | optional |
| `ALERTS_EMAIL_API_KEY` | (listed above) placeholder, unused until an email provider exists | — | leave empty |
| `DEPLOYER_ADDRESS` | M5.22: **public address** of the throwaway testnet wallet that deploys our test venue (`foundry/script/DeployTestPool.s.sol`). Address only; the key stays in the operator's Ledger or forge encrypted keystore and is never put in env | Gofi (wallet) / Robin (runs it) | optional (only for the §9.1 testnet broadcast) |
| `TEST_POOL_SEED_NVDA` | M5.22: pool seed size in whole tNVDA (1..10000, default 100) | Robin | optional |
| `TEST_POOL_ENABLED` | M5.23: `true` turns on the test-pool quote/swap-prepare and deposit-prepare routes. Also needs the three addresses below; any empty = off | Robin | optional (default false) |
| `TEST_POOL_ADDRESS`, `TEST_USDG_ADDRESS`, `TEST_NVDA_ADDRESS` | M5.23: addresses printed by the §9.1 broadcast (pool, tUSDG, tNVDA). Public addresses; empty placeholders until deployed | Robin | required if `TEST_POOL_ENABLED=true` |
| `TEST_POOL_RPC_URL` | M5.23: RPC used for read-only pool quotes; unset = `TESTNET_RPC_URL` | Robin | optional |
| `DEV_LOGIN_ENABLED` | dev login; refused outside mock | — | must be unset/false in prod |
| Others (`PORT`, `ENGINE_*`, `SSE_*`, `MAX_*`, `LEADERBOARD_MIN_TRADES`, `SK_*`, `HL_NETWORK`, `PRICE_SOURCE`, `BACKTEST_EQUITY_SOURCE`, `MULTILEG_FAILURE_POLICY`) | tuning with safe defaults (see `.env.example`) | Robin | optional |

No private keys are ever configured on the server: all signing happens in the user's browser wallet.

**Listen host (M5.26).** `HOST` sets the listen address and defaults to `127.0.0.1`. On the VPS it **replaces the `bind.mjs` preload**: once a release with M5.26 is deployed, drop `--import bind.mjs` from `NODE_OPTIONS` in api-start.bat, leave `HOST` unset (loopback) and set `PORT=8987`. Then confirm with `netstat -ano | findstr 8987` that the API is listening on `127.0.0.1:8987`. Never set `HOST=0.0.0.0` on the VPS.

| `HOST` | API listen host (default `127.0.0.1`) | Robin | optional (leave unset) |
| `PORT` | API port, **8987 on the VPS** (default 8787 for local dev) | Robin | **required** on the VPS (`8987`) |

**Per-IP caps rely on Caddy (M5.25).** Every per-IP limit uses the first `X-Forwarded-For` entry when `TRUST_PROXY` is on and the peer is loopback (or `TRUST_PROXY_PEERS=any`). That covers public auth/exchange, wallet-link, the 120/min invalid-request cap and the other `pubLimit` buckets. Caddy must **overwrite** the header with the real client address, not append to it. Use `header_up X-Forwarded-For {remote_host}`, or Caddy's default `reverse_proxy` with no `trusted_proxies` set, which rewrites it. If the header gets passed through, a client can pick any IP and dodge every per-IP cap. Keep the API port (**8987 on the VPS**; 8787 is only the local-dev default) bound to 127.0.0.1 so only Caddy can reach it. Per-user caps (for example `INVALID_PER_USER_PER_MIN`) don't depend on this.

| `PRIVY_JWKS_MIN_INTERVAL_MS` | min ms between Privy JWKS fetches (default 30000, floor 10000) | Robin | optional (leave unset) |
| `INVALID_PER_USER_PER_MIN` | per-user cap on 422/413 requests per minute (default 60, 0 = off). The per-IP 120/min cap always applies | Robin | optional (leave unset) |

### 9.1 Testnet 46630 test-venue broadcast (M5.22; operator-run, needs Honey's approval)
The server never signs, broadcasts or reads a key. A human runs these steps on their own machine.
1. **Wallet.** Create a fresh, throwaway testnet-only wallet (never one that holds mainnet funds). Put its public address in `DEPLOYER_ADDRESS`.
2. **Faucet.** Open https://faucets.chain.link/robinhood-testnet, connect that wallet, request 46630 test ETH. Check: `cast balance $DEPLOYER_ADDRESS --rpc-url https://rpc.testnet.chain.robinhood.com`.
3. **Signer, pick one** (the key never touches env, shell history or the repo):
   - Ledger: plug in, open the Ethereum app, then use `--ledger` (add `--mnemonic-derivation-paths "m/44'/60'/0'/0/0"` if not the first account).
   - Encrypted keystore: `cast wallet import quiver-testnet --interactive` (paste the key at the hidden prompt; it is stored encrypted under ~/.foundry/keystores), then use `--account quiver-testnet` (password prompt at broadcast).
4. **Dry run** (simulation only, nothing signed):
   `cd backend/foundry && forge script script/DeployTestPool.s.sol --rpc-url https://rpc.testnet.chain.robinhood.com --sender $DEPLOYER_ADDRESS`
   It must print `chainId 46630`; the script reverts on any other chain.
5. **Broadcast** (only after approval):
   `forge script script/DeployTestPool.s.sol --rpc-url https://rpc.testnet.chain.robinhood.com --sender $DEPLOYER_ADDRESS --account quiver-testnet --broadcast` (or `--ledger` instead of `--account …`).
6. **Addresses into env.** Copy from the console output (or `broadcast/DeployTestPool.s.sol/46630/run-latest.json`, field `transactions[].contractAddress`):
   `tUSDG` → `TEST_USDG_ADDRESS`, `tNVDA` → `TEST_NVDA_ADDRESS`, `pool` → `TEST_POOL_ADDRESS`; then `TEST_POOL_ENABLED=true` in the VPS env. Feeds (`feed tUSDG/USD`, `feed tNVDA/USD`) are informational for now.
7. **Check.** `cast call $TEST_POOL_ADDRESS "reserve0()(uint256)" --rpc-url …` returns seed×200e6. After the API restart (Robin), `GET /v1/testpool/status` shows `enabled:true`.

