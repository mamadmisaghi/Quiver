# Sage — M5 backend slices (QA notes)
(M5.0 read-only testnet adapter: see sage-M4-slices.md, last section.)

## M5.1 — market detail
- `GET /v1/markets/<enc id>/history` → 1h×7d bars, last bar ≤ now, stats.last = last close. `?tf=15m&range=30d` → 422 (500-bar cap). `?tf=2m` → 422. Unknown id → 404. Signed out → 401.
- `GET /v1/markets/<enc id>/detail` → market + 1d/7d/30d returns + 30d high/low/vol; mock mode notice "Example data".
- Tests: test/integration/m51.test.ts (3).

## M5.2 — Privy sign-in + wallet link
- No PRIVY_* on the server: `GET /v1/auth/config` → privy.enabled false; a non-dev idToken → 503 auth_unavailable (fail closed). dev: token with dev login off → 401.
- With Privy set (later, by Gofi): real Privy identity token → 200; tampered/expired/other-app token → 401.
- Wallet link: challenge → sign message in wallet → verify → listed in /me/wallets; reuse of a nonce → 422; signing with a different wallet → 422; DELETE unlinks.
- Tests: test/integration/m52.test.ts (16, incl. 11 rejection cases with locally minted ES256 tokens).

## M5.3 Write off a stuck position (paper)

Paper runs only (other modes: 422 `mode_not_enabled`). For positions that cannot be closed. Recovery is zero: a spot position loses its cost basis, and a perp loses its posted margin (|qty|·avgEntry/leverage). The loss is booked as realized P&L.

- `GET /v1/runs/:id/positions/write-off?instrument=<id>` returns `{runId, instrument, eligible, reasons: ("no_price"|"price_stale"|"venue_down"|"close_rejected")[], message, position: {qty, avgEntry, kind}|null, basis:"zero_recovery", lossUsd|null}`.
  - The position is eligible when at least one reason applies.
  - A normal session close (staleReason `market_closed`) does **not** count as stuck.
  - `close_rejected` means a `/positions/close` on this run+instrument failed in the last 24 h.
- `POST /v1/runs/:id/positions/write-off {instrument, confirm:true}` returns `{runId, instrument, writtenOff:true, reasons, qty, avgEntry, lossUsd, basis:"zero_recovery", at}`.
  - Errors: 409 `conflict` if the position is still closable; 404 for no position or a run that is not yours; 422 if `confirm` is missing; limited to 10/min per user.
  - Side effects: the position and its pending orders are removed. A `warning` event with code `position_written_off` goes on the run log, and an audit entry `run.write_off` is recorded.


Tests: test/integration/m53.test.ts (3).

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


Tests: test/integration/m54.test.ts (3).

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

Tests: test/integration/m55.test.ts (2).

## M5.6 (Sage) — Compile from a chart screenshot (vision)

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

Tests: test/integration/m56.test.ts (3). Total 417/417, forge 54/54.

## M5.7 (Sage) — Shareable video replays (API + data; renderer is a stub)

A share is a **frozen** snapshot of the M4.4 replay, taken when it is created; later run activity does not change it. Only paper and testnet runs can be shared, at most 20 active shares per user.
- `POST /v1/runs/:id/replay/share` (owner, 10/min): body `CreateReplayShareReq` `{ title?≤80, frameMs=60000, maxFrames 10–500 =300, from?, to?, render?: RenderSpec }`. Returns 201 `ReplayShareView` `{ token:"rpl_…", path:"/v1/public/replays/<token>", runId, title, createdAt, revokedAt, frames, digest, render: RenderJob }`. Errors: 404 for someone else's run; 422 for a live run, an empty range or bad params; 429 `limit_exceeded` past 20.
- `GET /v1/me/replays` → `{ items: ReplayShareView[] }`, newest first, revoked ones included.
- `POST /v1/replays/:token/render` (owner, 5/min): body `RenderSpec` `{ aspect:"9:16"|"16:9"|"1:1" ="9:16", fps:24|30 =30, durationSec 5–60 =20 }` → 202 `RenderJob`. 409 while a job is queued or rendering, or if the share is revoked.
- `DELETE /v1/replays/:token` (owner) → 204. The public link becomes 404 and any queued job is cancelled.
- `GET /v1/public/replays/:token` (no auth, 60/min/IP, `noindex`): returns `PublicReplay`, the replay fields minus `runId`, plus `{ token, title, handle, strategyName, mode, createdAt, render:{status, videoUrl, posterUrl} }`. It contains no run, user or account ids.
- `RenderJob` `{ status: none|queued|rendering|done|failed|not_configured, jobId, renderer, spec:{aspect,fps,durationSec,width,height,totalFrames}|null, requestedAt, finishedAt, videoUrl, posterUrl, error }`. Sizes: 9:16 → 1080×1920, 16:9 → 1920×1080, 1:1 → 1080×1080.
- The renderer is pluggable (`ReplayRenderer` in `src/replay/render.ts`). The shipped `stub` produces no video and finishes jobs as `not_configured`. The UI should show the replay player from the frames and hide "download video" until `status=done`. A worker loop runs every 5 s.

Tests: test/integration/m57.test.ts (2); m34 public-route allowlist updated. Total 419/419, forge 54/54.

## M5.8 (Sage) — Telegram and X alert adapters (stubs)

The webhook is unchanged: `/v1/alerts/settings` and HMAC signing behave as before, and every M4.x webhook test still passes. Telegram and X are pluggable `ChannelAdapter`s (`src/alerts/channels.ts`). They validate the destination and render the exact text, but **never call Telegram or X**.
- `GET /v1/alerts/channels` → `{ items: AlertChannel[] }`. Each `AlertChannel` is `{ name:"telegram"|"x", label, primary, status:"ok"|"stub"|"not_configured", target|null, targetHint, maxMessageLength }`. `status` is `not_configured` when the token env is unset and `stub` when it is set but the sender isn't wired. It is never `ok` yet.
- `PUT /v1/alerts/channels/:name` with body `{ target: string≤64 | null }` → `AlertChannel`.
  - Telegram targets: a numeric chat id (5–16 digits, optional leading `-`) or `@channel`.
  - X targets: a handle of up to 15 characters; `@` is added if missing.
  - `null` clears the target. An invalid target → 422 `validation_failed` with `details.field="target"`; an unknown channel → 404.
- Fan-out: each matching rule event and each `POST /v1/alerts/test` makes the usual primary delivery, plus one delivery per channel that has a target. Each has `provider: "telegram"|"x"` in `/v1/alerts/deliveries`. Stub deliveries end immediately as `status:"not_configured"`, with `lastError` saying nothing was sent, and are never retried. The response body of `POST /alerts/test` is still the primary delivery.
- `AlertProviderName` now includes `"x"`. `ALERTS_PROVIDER=telegram|x` makes that stub the primary (no double delivery).
- New env placeholders `TELEGRAM_BOT_TOKEN` and `X_ALERTS_TOKEN`. Neither is ever used to send.

Tests: test/integration/m58.test.ts (3); m40 webhook suite still green. Total 422/422, forge 54/54.

## M5.9 (Sage) — User-supplied RPC endpoints and AI keys (write-only, encrypted at rest)

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

Tests: test/integration/m59.test.ts (13 incl. 9 SSRF cases). Total 435/435, forge 54/54.

## M5.10 (Sage) Gate fixes (Robin M5 report): changed shapes

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

Tests: test/integration/m510.test.ts (11); m56 fixtures now structurally valid; m57 title expectation updated. Total 446/446, forge 54/54.

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
