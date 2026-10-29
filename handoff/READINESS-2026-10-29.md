# Quiver readiness review — 29 October 2026

## Executive conclusion
Quiver has a substantial application shell and a real, tested paper-engine codebase. The current Site is a preview, not a deployed trading platform. A percentage such as “80% complete” conflates interface coverage with production readiness. Completing a paper beta, a testnet product and multi-venue mainnet execution are different release gates.

Scope: source inspection of the imported web/backend/contracts, original handoff and parity notes, current Site source and runtime behavior. This is an engineering/UX readiness review, not an independent smart-contract audit or legal opinion. No provider keys were reused from another project. No transaction was signed or broadcast.

## Critical verified findings
1. **P0 / Functional:** original web `mockApi.compile` ignored prompt semantics and returned F.PARTIAL_NODES, F.HUMANIZED and the same strategy for every input. It only changed the stored thesis. The original backend compiler was not connected to the hosted frontend.
2. **P0 / Functional:** mock `createStrategy` returned a fixed existing fixture; “Edit” links opened a fresh default builder, and public forks were not saved.
3. **P0 / Integrity:** backtest results, paper-stream events, portfolio, leaderboards and rewards in the hosted mock adapter are fixtures, not evaluation of a custom idea. A new custom strategy must never inherit an unrelated example run.
4. **P1 / Data loss:** backend uses new MemStore on boot. FilePersistence is mock-only. DATABASE_URL and REDIS_URL in configuration do not implement a persistent database or distributed engine. Restarts/scale-out need durable strategies, runs, events, grants, idempotency and ownership locks.
5. **P1 / Deployment:** original backend is Node/Hono with background timers, streams, local file media and optional FFmpeg. Current hosting runs a Worker frontend. It needs a separately deployed persistent Node API/worker or an explicit architecture migration, not just switching API_MODE to live.
6. **P1 / Auth:** Privy login UI and ES256/JWKS verifier exist, but live login/refresh/logout/cookie/CORS/owner isolation still need configured end-to-end verification. Dev login is not a production auth solution.
7. **P1 / Execution:** default venue adapters are MockVenueAdapter; SessionKeyService is wired to MockSigner and derives mock smart-account addresses. Real session-account deployment, secure signer integration, confirmations/indexing and each venue's execution adapter are unfinished. Supplying an Alchemy key alone does not complete them.
8. **P1 / Chain verification:** the imported 46630 verification registry has failed/partial entries; a test-pool script exists but no funded deployment/address evidence is supplied. Revalidate current chain deployments, feeds and bytecode before enabling any on-chain route. Historical verification files are evidence of prior checks, not current network truth.
9. **P1 / Market data:** stock history adapters and read-only Chainlink/Jupiter code exist; current Site uses fixtures. Need configured data sources, stale/gap/session/corporate-action behavior and unambiguous synthetic/modelled/real provenance. Stock-token identity mapping is inconsistent between older web fixtures and backend registry (e.g. placeholder ...a3/a4 symbols); consolidate before connecting real data.
10. **P1 / Eligibility:** GeoIP database lookup is explicitly not wired in src/api/app.ts; outside mock, stock eligibility fails closed. Policy and terms finalization remain owner decisions and cannot be inferred from mock country headers.
11. **P1 / Tests:** prior full backend run: 539 passed, 5 failed, 9 skipped (82 files: 78 pass, 2 fail, 2 skip). m421 TLS tests and m513 pinned RPC timeout need a reliable-host rerun and cause confirmation. Anvil/Foundry and real provider integration were not verified here. These results must not be called a green production gate.
12. **P2 / UI workflow:** no independent save action; stale graph can remain after changing prompt; auto-drafting on navigation can spend quota; error text occupies a fixed single-line slot; old backtest state can remain after strategy change; chart reading/refine look available when their service is absent. Graph nodes are read-only display, not a drag/drop or form editor; marketing previously suggested tap-to-edit.
13. **P2 / State consistency:** most preview settings/approvals/autopilot/copies mutate only fixtures or module memory. Selected filters, result names and run state can disagree across fixture sets. Backend services need to become the sole account-data source.
14. **P2 / UX polish:** make pending navigation visible, consolidate per-page empty/error/retry states, add saved/dirty/unsaved-leave feedback and explicit run-mode/data-source labels; audit small-screen pinned action bar, graph panning, keyboard/reader access and long text. Preserve charcoal/amber, Geist/Instrument Serif, sidebar and graph visual language.
15. **P2 / Copy consistency:** docs state session-key expiry “7 days default, 30 max”; current config defaults are 24h/168h. Use server-returned defaults in product/docs and align with contracts. Do not change policy merely to make copy match.
16. **P2 / Performance:** many code-split chunks exist (Privy/crypto dependencies); total build bytes are not initial page transfer. Measure cold-load and route navigation on the production bundle, with mobile CPU and reduced motion. Prior production next/link issue demonstrates why dev-only QA is inadequate.

## Work completed in this continuation
- Reused original backend `compile` generator through a bounded free `/api/preview/compile` endpoint. It has no LLM credential, no signer and no live-trading authority. Prompt-specific parsing, validation, human-readable rules, partial nodes and unsupported errors now replace the fixed web sample.
- Limited keyword parsing is explicitly labelled. English examples are within tested supported cases; free-form AI, image interpretation and AI refinement are not misrepresented as connected.
- Added local browser draft saving (up to 50 records), actual strategy/nodes in saved records, persistent preview forks, reopening via ?strategy=<id> and View drafts. This is not account/database sync.
- Added an independent save control, changed-text guard, explicit Draft action (no auto-compile), old-state clearing, aborted-request protection and backtest reset on strategy change.
- New custom preview runs are blocked until the actual paper engine is connected; existing example-run screens remain sample demonstrations. Backtest button/copy now explicitly labels fixed example results.
- Removed misleading “tap node to change” claim. No visual redesign or tokenomics change.

## Existing implementation that should be retained
Strict Zod schemas and semantic validator; deterministic rule/executor/backtest code; typed NDJSON/SSE with tickets and resync; risk gates and paper approvals; provider spend/concurrency limits; SSR share metadata; CORS allowlist; secret encryption and SSRF-pinned RPC/webhooks; readonly chain adapters; reduced-motion and mobile layout code.

The older handoff is stale on several points: stored per-user RPC/AI keys are consumed at call time; Telegram/X have real HTTP adapter code; FFmpeg renderer exists. They need configuration and end-to-end validation, not wholesale reinvention. Comments that still say “stub” are not authoritative where implementation contradicts them.

## Keys and services: owner supplies vs operator generates
### Paper beta (first release gate)
- Owner: a project-specific OPENROUTER_API_KEY with spending limit; choose LLM_MODEL supporting JSON schema. Add LLM_VISION_MODEL only if chart reading is included.
- Owner: PRIVY_APP_ID, PRIVY_APP_SECRET for a Quiver app; optionally verification key/JWKS. Whitelist the actual frontend origins. Public app ID alone goes to frontend; secret stays server-side.
- Owner/operator: a persistent Node hosting target and Postgres; DATABASE_URL after the adapter/migrations are implemented. Redis/queue/locks for durable jobs and multiple workers; REDIS_URL alone does nothing without integration.
- Owner: licensed market-data access, current integration TIINGO_API_KEY, or explicitly choose synthetic-only paper beta. Price feed RPC access can use configured read-only endpoints; dedicated provider needed for dependable service.
- Operator generates: QUIVR_JWT_SECRET, SECRETS_MASTER_KEY (32 bytes), OPS_TOKEN and INTERNAL_PROXY_TOKEN where topology needs it; exact origin config PUBLIC_BASE_URL, SIWE_ORIGIN, CORS_ORIGINS. Owner need not invent or buy these secrets.
### Testnet after paper beta
- Owner: Alchemy project/API key (ALCHEMY_API_KEY), TESTNET_RPC_URL for 46630. Optional gas policy ID only if sponsoring transactions.
- Owner: fresh EVM testnet wallet with test ETH, public DEPLOYER_ADDRESS. Private key/seed stays in the user's wallet; operator signing/broadcast requires a separate explicit authorization.
- Deployment results: TEST_POOL_ADDRESS, TEST_USDG_ADDRESS, TEST_NVDA_ADDRESS and verified session-account/router addresses; these are generated by a real testnet deployment, not purchasable API keys.
### Optional integrations
- Telegram: TELEGRAM_BOT_TOKEN and user-started bot/chat destination; X: X_ALERTS_TOKEN with required DM scope, provider access and recipient validation. No messages sent during this review.
- Replay: FFmpeg binary/path, persistent render directory and durable queue; optional R2/object storage for hosted videos. No external video API is inherently required.
- Own keys/RPC: SECRETS_MASTER_KEY + durable encrypted storage and SSRF protections.
### Mainnet only
- Verified Uniswap/0x routing configuration and credentials if selected; liquidity, limits and fee handling validated per venue.
- Real signer/account integration, safe grant/revoke lifecycle, secure session-key custody, simulation and receipt reconciliation; external contract review.
- Public treasury/fee-router addresses, fee/creator-share decisions, token launch decision (no $QUIVR contract exists), geo/terms approval.
- Hyperliquid and Solana require separate account/signer/permission/execution paths. Their presence in the graph is not proof of working execution. Polymarket is signal-only by product design.

## Completion sequence and acceptance gates
1. Functional paper beta: authenticated idea -> AI -> validated graph -> save -> real backtest -> server paper run -> SSE events -> stop -> history after restart, including ownership isolation. No fixed fixture results in that flow.
2. Durable operations: DB migrations/backups/restore, Redis jobs/locks, deploy/restart safety, structured logs/metrics, rate limits, spending cap, incident stop controls, error monitoring. Test graceful deploy with active runs and reconnection.
3. Testnet: funded custom test venue, verified chain/account bytecode, wallet consent on every grant/install, deposit/swap/receipt/expiry/revoke, negative permissions tests, fresh worker recovery.
4. Mainnet one venue at a time: external contract/security review, verified routers/feeds/addresses, finalized policy/limits, funded small internal pilot then controlled rollout. Other venues only after their own integration gates.
5. Final UI pass: consistent action labels, no false affordances, mobile graph/action-bar checks, keyboard/dialog/focus checks, production navigation regression, loading/error/empty states, source labelling and docs.

## Verification limits
Impeccable automatic context engine was unavailable; manual review used existing source and brand tokens. No automated detector score, fresh Lighthouse score, physical mobile/touch claim, formal WCAG certification or independent security audit is claimed. Existing historical QA reports are retained as historical evidence, not current acceptance.
New scoped integration checks cover input-specific compiler frames (NVDA/ETH), timer strategies, unknown prompt error, invalid/oversized requests, honest disabled refinement and persisted draft content. Frontend production build/typecheck and actual hosted browser regression are required before delivery.
