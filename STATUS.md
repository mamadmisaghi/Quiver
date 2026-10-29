
## Slice 5 — Ellis motion merge (merge aad599f)
- Merged ellis/quiver-motion @ 4a9758c; EdgeComets/FlightField used as-is (src/motion untouched).
- Hero graph card: backdrop-blur-md -> bg-bg-2/95.
- StrategyGraph: size picked pre-paint via @container query + CSS vars (no 880->compact jump). Builder AI-draft strip reserves mobile height. /app/new CLS @390: ~0.004 (was 0.025 / 0.050).

## Requests (Sage)
- Equity series, market sparklines, node titles; endpoints for public strategies, traders, rewards, revenue, skills (those pages still on lib/mock).
## Open
- Ticker: brand kit says $QVR, brief says $QUIVR (using $QUIVR).

## Slice 6 + backend M3 sync (Wren)
- Live adapter (`NEXT_PUBLIC_API_MODE=live|mock`), dev login via `dev:` idTokens, fetch-based SSE with Last-Event-ID, `retry` honoured, heartbeat lastSeq, slow_consumer resync reconnect.
- M3: BacktestPanel (stats, costs, coverage source labels Chainlink/Modeled/—), market_closed human copy, stale "Market closed" state, NYSE session label on stock rows.
- Shots: shots/slice-6/ (1440 + reduced). Builder+backtest shot in mock (backend demo compile returns compile_failed without an LLM key); builder-live shows the live error state.

## M3.1 (backend a1b7ca3, contracts §14)
- Contracts re-synced; RunStreamFrame stream (heartbeat/resync don't advance seq; resync reconnects), staleReason/PricePoint/PriceSource, Market.priceStale.
- Demo compile pill + notice; unsupported_prompt suggestion chips. Geo: 451/NVDA fallback removed; geoRestricted → muted "Restricted" tag.
- Rewards rebuilt on new RewardsRes. Mock startRun respects strategyId; coverage rows never show raw ids.
- Landing SAMPLE_PROMPT/VENUES → src/content/landing.ts. Fixtures strict (no _comment).
- Shots: shots/slice-7 (live, 1440 + reduced).

## Mobile polish v2 + M3.2 sync (Wren, 2026-10-27)
- Shell: sticky header + 5-item bottom nav (safe-area) + "More" drawer (dialog, Esc, scroll lock) below lg.
- Tables → cards below 1024px via `.rtable` + `data-label` (markets, strategies, traders, revenue, run signals/positions).
- Graph: compact vertical layout <560px; wide layout min 720px and pans/scrolls (touch-action pan-x pan-y) when narrower.
- Coarse pointer: 44px min tap targets (a[href] gets a 44px ::after hit area). Action bar and toasts sit above bottom nav + safe area.
- Motion: src/motion/motion.css media queries now also require (hover: hover) and (pointer: fine) → motion off on touch. (Ellis's file.)
- CLS: builder reserves step slots (6), summary line, notice, graph height (reserve) and backtest area; run feed uses fixed-height rows moved by transform. All pages < 0.01 at 390/768 (scripts/mobile-audit.py).
- M3.2: contracts re-synced; Mock/Unverified badges from Market.isMock/addressVerified; SignalSource labels (all mock_* → "Simulated"); notices shown verbatim; mock stream skips heartbeat frames (fixture now contains one) and uses M3.2 source enums.
- Shots: shots/mobile-v2 (390 all pages + reduced, 768 subset), shots/slice-8 (live 1440 builder + markets).

## M3.3 sync (Wren, 2026-10-27)
- Contracts re-synced to 7c0c3e5. Mock badge only when isMock (price source); quiet green "Verified" chip when addressVerified; muted "Unverified" when false. jupiter_readonly → "Jupiter"; coverage none → "—". Instrument ids never rendered. Live shots: shots/slice-9/.

## M3.4 (backend 66e78cd, §17)
- Contracts re-synced (change24hSource, payload_too_large, strict CORS config).
- 24h cells get a tooltip from change24hSource (computed / reported by the price source). Shown on Markets and Home.
- 413 now shows "That prompt is too long…". Non-JSON error bodies map by status.
- Backtest validation_failed (window shorter than one bar) shows inline guidance, not an error.
- "No price data…" and "No trades…" caveats render as muted notes.
- 429 on /auth/exchange and /auth/refresh: backoff via Retry-After or 2^n, max 3 retries, with a quiet "Retrying in Ns" pill in AppShell.
- README, restart.sh and .env.example document CORS_ORIGINS=http://localhost:4317 (exact origin, no wildcards).

## Wren — M5.12–M5.15 frontend slice (contracts @ backend 6d3a108) — 2026-10-28
- Activity feed (M5.12): real GET /v1/activity via `api.activity` (scope all|following|mine, cursor "Load more", 6 kinds). New /app/activity page (tabs All/Following/Yours) + "Activity" nav item; /u/[handle] section (yours = mine; followed trader = following filtered to them; otherwise a follow hint). Sign-in, empty, error/retry states. No PROPOSED-API entry; mock adapter kept minimal for API_MODE=mock only.
- Chain accounts (M5.13): Wallets → "Testnet account" read (46630, read-only) with "Using your RPC" / "Quiver RPC" tag from x-quiver-rpc; calm 503 venue_unavailable, 422 rpc_url_blocked → Settings link.
  - BACKEND ASK: CORS doesn't expose x-quiver-rpc (app.ts corsOpts has no exposeHeaders), so cross-origin (localhost:4319→8795) the browser can't read it and the tag shows "—". Same-origin /v1 deploys are fine. Needs `exposeHeaders: ["x-quiver-rpc"]`.
- Alert channels (M5.14): status ok = "Sending", not_configured (and legacy stub) = "Not set up on this server" + explainer; deliveries show provider, and failed rows show lastError.
- Replay media (M5.15): lib/api/media.ts resolves /v1/public/replays/… media against the API origin (client: NEXT_PUBLIC_API_BASE; server: serverMediaUrl for og:image poster in /r/[token] metadata). Video player + "Download video (MP4)" on owner share row and public replay; 429 → calm "queue is full" status.
- Fixed axe label-content-name-mismatch on replay Prev/Next.
- Checks: tsc, eslint (1 pre-existing `_r` warning), next build OK. /tmp/wren-m515.py at 360/390/768/1024/1440: axe 0 serious/critical on activity, profile, wallets, settings, replay, public replay; no overflow; no page errors. Real ffmpeg render → done, video 200 video/mp4. Screenshots shots/m5-1/m515-*.

## Wren — M5.16 (backend 74b5a26) — 2026-10-28
- Contracts re-synced (ActivityQuery.handle, ActivityRes.limited).
- /u/[handle]: the follow hint is gone; other traders' profiles use GET /v1/activity?handle=@x (cursor paging, scope not sent). The handle is always sent with its @ (/u/demo_marco → @demo_marco). limited:true → "No public strategies yet." On handle feeds run is null, so there are no run or profile links. A 404 (profile or activity) → new ProfileNotFound ("Trader not found" + Browse traders). Your own profile still uses scope=mine. useQ now exposes the error status.
- RPC tag cross-origin verified for real: :4319 → :8795 with CHAIN_READS_ENABLED=true; the browser reads x-quiver-rpc=server (access-control-expose-headers: x-quiver-rpc present). "user" could not be exercised for real on the box: PUT /me/secrets/rpc for the public testnet RPC returns 422 rpc_url_blocked because the box DNS resolves it to a reserved address. The "user" UI path was covered by the M5.15 stub.
- Checks: tsc, eslint (pre-existing `_r` warning only), build OK. /tmp/wren-m516.py at 360/1024/1440: axe 0 serious/critical (profile, limited, 404, wallets), no overflow, no page errors. Handle paging (stub) 3 → 6 items with cursor+handle. Shots: shots/m5-1/m516-*.

## Turn 6A — Testnet deposit + test pool (backend ab57b1b, M5.23–M5.25)
- Contracts synced from ab57b1b (testnet.ts, `insufficient_balance` ErrorCode). config.ts still dropped.
- API: `depositPrepare`, `testPoolStatus` (public, no auth), `testPoolQuote`, `testPoolSwapPrepare` — live + mock (`testnet-mock.ts`; QA knob `localStorage["quiver.mock.testnet"] = off|rate|recheck|undeployed`).
- UI: /app/wallets → "Testnet deposit & test pool" (components/testnet/TestnetPanel.tsx). Every block tagged TESTNET. Deposit (ETH/tUSDG/tNVDA) shows Recipient verified/unchecked; test pool swap shows quote, min received, ordered steps [approve?, swap].
- Signing: `lib/wallet.sendTestnetTx` — click-only, refuses tx.chainId ≠ 46630, asks the wallet to switch then re-checks eth_chainId, requires the wallet account = tx.from; waits for receipt before the next step. Quiver never signs or sends.
- Errors (`components/testnet/tnErr.ts`, by code + details.reason): chain_not_allowed, amount_out_of_range, too_many_decimals, insufficient_balance ("You have X, need Y"), wallet_not_linked (→ Link it), no_smart_account / smart_account_not_deployed (→ runs), recipient_check_unavailable (calm + Retry), quote_unavailable (+ Retry), venue_unavailable/disabled → "Test pool not enabled", 429 Retry-After header → body retryAfterSec countdown. Amounts pre-validated client-side (AmountStr, per-token decimals and caps).
- Tests: mock-wallet E2E (mock API): nothing sent before click; deposit tx 0xb626; approve then swap in order; wrong chain / user reject send nothing. Live (ab57b1b, SIWE_ORIGIN set): real link via throwaway key → `no_smart_account` path; status 200 enabled:false → "Test pool not enabled". axe 0 / overflow 0 at 360/390/1440 with both panels in prepared state.

## Turn 6B — Public strategy page (parity gap; backend ab57b1b)
- New route /app/strategies/[id] (components/strategy/PublicStrategyView.tsx). Live: GET /public/strategies/:id + POST /public/strategies/:id/fork (idempotency key). Mock: ext.public-strategy.json + two details captured from Sage's seed (ext.public-strategy.{1,2}.json, `mock: true`, shown as "Example data").
- Page: venues, Paper tag, name, author, forks, published, "forked from" link, 30-day paper return + spark, thesis, StrategyGraph, plain-word rules (Signals/Trigger/Actions/Exits), Fork to edit (→ "Saved to your strategies as … v1. Nothing is running yet.") and Copy to paper (existing CopyDialog). 404 → "This strategy isn't public". Signed out → Sign in.
- Public strategy cards on /app/strategies now link here. Mock builds prerender the three seeds with data in the HTML (LCP fix); live resolves on the client.
- Checks: mock + live E2E (open from feed, fork shows in list, 404), axe 0 / overflow 0 at 360/390/1440, mobile Lighthouse perf median 95 (A11y/BP/SEO 100), CLS 0.004.
- Not done: ⌘K and profile "public strategies" still link to profiles — mock search/profile ids don't match the public-strategy fixtures (stg_01M5… vs stg_demo…).
- Wren → Ellis: motion brief below (ready).

### Motion brief — public strategy page (Ellis)
Hooks: `ps-page`, `ps-head`, `ps-return`, `tick` (the return figure), `ps-thesis`, `ps-graph`, `ps-rules` / `ps-rule` ×4, `ps-actions`, `ps-forked`, `ps-error`, `ps-missing`.
1. Arrival: head, then thesis, then graph, a short stagger (≤240ms total). No motion on text weight or size. LCP is the thesis paragraph, so it must paint at full opacity on the first frame. Animate only transform, or the elements under it.
2. Graph: reuse the builder's signal→trigger→action→exit edge pulse, played once on enter. No looping on a read-only page.
3. Rules: the four cells fade in left to right after the graph settles. On mobile they stack, so use a vertical order.
4. `tick`: count from 0 to the value once, mono digits, ≤600ms, with no colour flash.
5. Fork: the button goes to "Forking…" and then `ps-forked` replaces the copy line. A quiet crossfade and a single accent underline sweep are enough; no confetti or glow.
6. `ps-error` and `ps-missing`: static. Reduced motion: everything is instant.
Also on the testnet panel (turn 6A): `tn-section`, `tn-deposit`, `tn-swap`, `tn-prepared`, `tn-steps`, `tn-step[data-state=todo|active|done|failed]`, `tn-badge`, `tn-error`, `tn-quote`, `tick` (You get), `tn-off`. Step state changes are the key moment: active step pulse, done check.
