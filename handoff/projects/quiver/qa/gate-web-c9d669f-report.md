# Gate: web c9d669f (with backend 297d8dd and INTERNAL_PROXY_TOKEN). Result: PASS, deployed

Robin, 2026-10-28, Tehran time.

## Build
npm ci, tsc 0, eslint 0, npm audit 0. `next build` OK with 0 warnings (live mode, /v1, dev login). The VPS build gave BUILD_OK.

## Token handling (local harness: front → web → relay → API, so every API call was logged)
- `serverHeaders` sends the header only for 127.0.0.1, localhost and [::1]. Nothing is sent for 127.0.0.2, 10.x, the public IP, evil subdomains, userinfo tricks, bad URLs or a blank env.
- Every relayed server fetch had the token matching and no XFF/X-Real-IP, even when the client sent XFF. This covers /u (proxy.ts), leaderboard and the /c card.
- Leak scan: the token value appears in 0 places: bodies, headers and RSC payloads of / /app /app/new /leaderboard /u /c /r; any file under .next; the web, API and front logs. The header name appears in 0 static chunks (local and VPS).
- Info: one static chunk contains the env *name* `INTERNAL_PROXY_TOKEN` (and `OPS_TOKEN`). These come from the shared contracts config zod schema. No values. It predates this commit. Worth tree-shaking out later.

## Profile cache (proxy.ts)
- 80 unknown /u gave 80×404 with the token set. A repeat of 20 made 0 API calls (cached).
- Variants: @demo_lena, %40 and %2540 give 200; uppercase, `.`, %20 and %00 give 404. @demo_lena still gives 200 afterwards, so no poisoning.
- An injected 500 or 429 failed open (200) and was not cached (404 once cleared). A hanging API failed open after 3.0 s and was not cached.

## On screen (signed in with the dev login; warmup forced with a hanging mock RPC)
- Market detail and backtest pages at 360, 390 and 1440 all show `warming up · partial data` (md-warmup and bt-warmup). The full text is in the title and sr-only. No horizontal overflow and no page errors.
- It reads calmly: small muted mono text next to the "Data: fallback" chip. No banner, no alarm colour. The long notice paragraph is suppressed while warming. Shots are in `qa/shots-c9d669f/` (`md-w-*`, `bt-w-*`).
- Nit: at 360 px the "Data: fallback" chip and the warmup text each wrap onto 2 lines. Still tidy.
- Info (backend): with a hanging RPC, warmup ends as `partial` after about 61 s, so in production the note is only visible briefly.

## Regression (4eaca8b checks)
At 360 and 1440 on / /app /app/new /leaderboard /app/markets /app/strategies: one `<main>`, axe wcag2a/aa 0 violations, no overflow, data-testids present. ⌘K opens the dialog. /u demo gives 200; /u, /r and /c unknown give 404.
Not tested: a real /r replay share (the share endpoint needs a finished run).

## Deploy (see vps-deploy-log.md)
- Backend first, then web, both with the token read via `set /p` from an ACL'd file. PIDs: API 1628, web 11704. Stable for more than 60 s.
- Outside, under load, from the VPS: 120 unknown /u within about 10 s gave **120/120 404**. pumpals.fun stayed 200 (4/4) during the load.
- A spoofed token header got 30×200 then 45×429 (normal limit, no 20× bucket).
- All other sites match the baseline.
