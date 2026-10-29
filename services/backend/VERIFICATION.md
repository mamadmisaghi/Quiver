# Verification & price modes (M2)

Run `npm run verify:testnet` (read-only). Writes `config/verified/46630.json` and `config/verified/4663-readonly.json`.
Every item stores sourceUrl, checkedAt, method, bytecodeHash. Loader (`src/verify/loader.ts`) fails closed: missing/invalid file or status != pass => unusable.

## Modes
| Mode | Prices | Execution |
|---|---|---|
| mock | synthetic | paper only |
| mainnet-readonly (`PRICE_SOURCE=mainnet-readonly`) | Chainlink 4663 feeds (RDD JSON https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json), bytecode-hash checked per proxy, stale > heartbeat+600s => null | paper + backtest only |
| testnet 46630 | — | **BLOCKED**: no verified DEX (V1/V2/V3), no Stock Tokens (V4). Live testnet swaps stay blocked until a testnet DEX exists or we deploy our own test pool. |
| local anvil | MockAggregator | MockPool + SessionAccount e2e (test/integration/anvil-e2e.test.ts) |

Non-Robinhood venues (Hyperliquid, Solana, Polymarket) remain mock. A mapped but unverified instrument returns null (`quote_unavailable`), never a mock fallback.

## V table (46630, checked 2026-10-27)
V1 FAIL (UR on 46630 has a different hash and no official listing → unused) · V2 FAIL (Trading API rejects 46630) · V3 FAIL (0x is 4663 only) · V4 FAIL (all 195 RH assets on 4663) · V5 FAIL (no testnet feeds) · V6 FAIL on testnet (mainnet VerifierProxy ok) · V7 FAIL (no sequencer feed; block watchdog; M3.6: SessionAccount supports an optional sequencer feed, off until a verified address exists) · V8 PARTIAL (local policy tests pass; EntryPoint v0.7 present; Alchemy untested) · V9 PARTIAL · V10 n/a · V11 PARTIAL (terms read 2026-10-27; Polymarket text unreadable → mock-only; see §V11) · faucet blocked (wallet-connect UI, no funds obtained).

## Foundry
M3.6 (2026-10-27): `forge test` 54/54 (SessionAccount.t.sol 22, RobinPoCRegression.t.sol 7, RobinV2.t.sol 19 — copy of qa/poc with slippage cap raised in setUp and the 3 P2 FINDING tests inverted into regressions, M36.t.sol 6). vitest 185/185 (23 files), `npm run lint` clean, `npm run typecheck` clean.
`cd foundry && git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std && forge test` (lib/out/cache gitignored). SessionAccount.sol is an UNAUDITED test model.

## §V11 Third-party terms review (M3, read-only, 2026-10-27)

Restrictions as written in each source. **Not legal advice; no conclusions drawn.** Everything here needs user sign-off (SIGNOFF.md).

| Source | URL (read 2026-10-27) | Restrictions noted |
|---|---|---|
| Robinhood Stock Tokens (docs) | https://docs.robinhood.com/chain/stock-tokens/ | Tokenised debt securities issued by Robinhood Assets (Jersey) Ltd; no legal/beneficial rights in the underlying. Mint/burn only Mon 02:00 – Sat 02:00 CET/CEST (market makers); end users may trade on-chain outside that window. |
| Robinhood Stock Tokens (offer page) | https://robinhood.com/rhj/stocktokens/ | Not registered under US securities law; may not be offered/sold in the US or to US persons. Restricted in other jurisdictions incl. Canada, UK, Switzerland; issuer publishes the full list. |
| Robinhood newsroom | https://robinhood.com/us/en/newsroom/robinhood-accelerates-global-expansion-robinhood-chain-mainnet-stock-tokens-agentic-trading/ | Adds UAE and sanctioned jurisdictions to the restricted list. |
| RHJ Base Prospectus | https://cdn.robinhood.com/assets/robinhood/legal/rhj_base_prospectus.pdf | Reg S: only outside the US, to non-US persons; issuer may publish/change a restricted-jurisdiction list and geo-restrict. Prospectus valid until 24 June 2027. Full prohibited-country list NOT read by us (a third-party summary lists Cuba, Belarus, Iran, North Korea, Russia, Syria, Ukraine, South Sudan, Sudan, Myanmar, Venezuela — **unverified**). |
| Chainlink Data Feeds | https://docs.chain.link/data-feeds/selecting-data-feeds , https://docs.chain.link/data-feeds/developer-responsibilities , https://chain.link/terms | Using feeds = accepting Chainlink ToS. No guarantee of accuracy/availability; developers are responsible for feed-quality evaluation, staleness/circuit-breaker checks and market-integrity risk. (Our code: heartbeat+grace staleness, market-closed handling, outlier filter.) |
| Uniswap Labs API Terms | https://support.uniswap.org/hc/en-us/articles/43018872248589-API-Terms-of-Use | Registration with accurate info; sanctions eligibility reps; no VPN evasion by restricted parties; licence non-sublicensable/non-transferable, only for apps that interoperate with the APIs; APIs currently free but fees/limits may change; end users must accept Uniswap terms (or equivalent); protect keys; no reverse engineering. |
| 0x API Licence Agreement | https://0x.org/legal/api-license-agreement , https://www.0xprotocol.org/terms-of-service | Only for Licensee's app; keys are 0x property, revocable; rate limits; no redistribution/resale/storage/derivative works of 0x Data outside the app; no service-bureau use; no security/perf testing without written consent. Keys must stay server-side (docs FAQ). Embargoed-jurisdiction reps (US/Cayman). |
| Hyperliquid Terms | https://app.hyperliquid.xyz/terms | Interface unavailable to persons in the US, Ontario (Canada), sanctioned/export-controlled territories and their citizens; outcome markets have extra "Excluded Persons"; no circumvention. API `legalCheck` (POST /info) returns `userAllowed`/`restrictions` per address — candidate gate (not yet wired). |
| Polymarket | https://polymarket.com/tos | **Not read**: page served a US geo interstitial ("trading is blocked in the United States") instead of the terms text. Polymarket signals stay mock-only. |
| Tiingo | https://app.tiingo.com/tos/ (§7.3, §9.7) | API data "for internal consumption only"; businesses must use a Commercial plan; redistribution only with permission + fees and "Data sourced by Tiingo" attribution; free Starter plan is for evaluation. → TIINGO_API_KEY stays unset by default; showing modeled backtests to users likely needs a redistribution licence (ask Tiingo). |
| Stooq / Yahoo | — | Not integrated (Stooq JS bot wall not bypassed; Yahoo terms not reviewed for this use). |

## M5.22 Slice C — M2 testnet 46630: V1–V4 status + own test venue script (Sage, 2026-10-28)
| Item | Status | Blocker | What unblocks it |
|---|---|---|---|
| V1 Uniswap Universal Router on 46630 | FAIL | Contract on 46630 has a different bytecode hash and no official Uniswap listing for 46630 | Uniswap publishes a 46630 deployment (or Robinhood lists one), then re-run `npm run verify:testnet` |
| V2 Uniswap Trading API | FAIL | API rejects chainId 46630; also needs an API key | Uniswap support for 46630 + `UNISWAP_API_KEY` (user) |
| V3 0x | FAIL | 0x supports 4663 only | 0x adds 46630 + `ZEROX_API_KEY` (user) |
| V4 Stock Tokens on testnet | FAIL | All 195 RH assets exist on 4663 only | Robinhood testnet Stock Tokens; none we can create |
Workaround built (no key, nothing signed or deployed): `foundry/script/DeployTestPool.s.sol` deploys OUR test venue on 46630/anvil only — tUSDG(6), tNVDA(18, test stand-in, not a Stock Token), MockPool @ 200, two test feeds. Refuses 4663/1. Signer comes from forge `--ledger` or `--account <keystore>` + `--sender $DEPLOYER_ADDRESS`; no private key in env. Tests: `foundry/test/DeployTestPool.t.sol` (5); anvil dry run (simulation only) OK.
To broadcast on 46630 the user/Robin must provide: a funded testnet deployer (faucet ETH, faucet is wallet-connect only), the deployer's public address, and run the command with their own Ledger/keystore after Honey's approval. Then Sage registers the pool in a `self-test-venue` verification entry (follow-up; not built).
