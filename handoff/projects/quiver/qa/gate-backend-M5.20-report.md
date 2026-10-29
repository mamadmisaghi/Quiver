# Gate: backend M5.20 — 85377f4 (on 86f3fa5). Robin, 2026-10-28 16:20–16:40 Tehran

**Result: PASS** (0 Critical / 0 High / 0 Medium; Low + Info below).

## Re-run checks (own worktree /tmp/gate20, Sage's WIP untouched)
- checks.sh: `ALL CHECKS PASSED`, exit 0. vitest **497/497** (67 files), forge **54/54**, LINT ok.
- `tsc --noEmit`: exit 0. `npm audit`: 0 vulnerabilities.
- Earlier Robin PoCs m515–m519: 55/56. The one failure is the m519 snapshot helper, which needs the `SNAP` env var (by design, not a regression).
- New PoC `qa/poc/robin-m520.test.ts`: 9/9.

## (1) GET /v1/public/profiles/:handle
- Public, no auth. Keys are exactly handle, exists, limited, displayName, bio, publicStrategies, followers, demo (strict zod). No usr_/did:/dev:/stg_/run_/0x… in any body.
- Limited rule: a user with 0 public strategies gets displayName/bio null and limited:true; after publishing, both appear (Sage's test plus mine).
- `x-robots-tag: noindex` and `cache-control: public, max-age=30` on 200.
- Unknown, malformed and unicode handles (`@nobody_zz`, `%E0%A4%A` bad escape, `%00`, `..%2f..%2fops`, `@a%3Fx=1`, Arabic, fullwidth, 500 chars, `%25`, CRLF) all return a clean 404, one identical body `{"error":{"code":"not_found","message":"Profile not found."}}`, with no stack.
- Rate limit 60/min/IP: the 61st request returns 429. With the default TRUST_PROXY=false, a spoofed X-Forwarded-For is ignored.
  - With TRUST_PROXY=true the first XFF entry is trusted, so a spoofed XFF bypasses the limit if the API is reachable without a rewriting proxy.
  - Live VPS check: from the VPS loopback, 30×200 then 429 on :8987. Then 35 requests via Caddy :8091 with spoofed XFF were all 429, so Caddy overwrites XFF and spoofing does not bypass the limit in production.
- Enumeration/timing: existence is public by design (200 vs 404). Median time is 0.43 ms for an existing handle vs 0.29 ms for an unknown one (in-process, 25 runs). Sub-ms and swamped by network jitter; the rate limit bounds probing. **Info.**

## (2) Fixes
- **drawFrames memory (was Medium, ~311 MB):** fixed. Frames are lazy (generator), with ih ≤ 320 and ≤ 900 frames. Measured peak heap+arrayBuffers in an isolated node process with --expose-gc, using a fake ffmpeg sink at 1080×1920:

  | build | N=900 | N=2700 | N=100k |
  |---|---|---|---|
  | 86f3fa5 | 150.7 MB | 447 MB | — |
  | 85377f4 | 70.6 MB | 67.3 MB | 51.9 MB |

  The peak is flat in N, so memory is bounded. It is mostly uncollected 173 KB frame copies waiting for GC.
  - **Info:** the code comment "far below 64 MB" is optimistic. The measured peak is about 52–71 MB, still about 6× better than before.
- **FFMPEG_PATH:** boot fails for `ffmpeg`, `./ffmpeg`, `C:\a\..\ffmpeg.exe`, `C:ffmpeg.exe`, UNC `\\srv\share`, embedded NUL and embedded LF. Absolute Windows and POSIX paths are OK. A trailing newline is trimmed by the env loader, which is harmless. Fixed.
- **Tiingo per-user cap:** default 15 network calls per hour per owner within the global 45. User 1 gets 15 calls; calls 16–17 return null, which means the `fallback` data source. Three more users bring the total to exactly 45. Cache hits are free. Owner ids are passed for backtests and market history. Fixed.
- **Search:** `q` is no longer echoed (also for `<script>`). A 1-character query, including " a " after trim, returns traders []. 2 characters list traders. Fixed.
- **SIGNOFF §9:** now lists CHAIN_ID, NODE_ENV, RPC_URL, AA_PROVIDER, LLM_PROVIDER, VERIFIED_READONLY_PATH, PRIVY_*, TESTNET_SESSION_ACCOUNT_CODEHASH and ALERTS_EMAIL_API_KEY, plus the M5.20 FFMPEG_PATH and Tiingo notes. Complete.

## (3) Known: /copy/wallet/%2e%2e
- GET/POST/PUT/DELETE all return 404 (not 501), and `/copy` state is byte-identical before and after. No side effects. **Info** (owner Sage).

## Findings
| # | Sev | Owner | Finding |
|---|---|---|---|
| B1 | Low | Sage | The public profile/cards/replays limits are keyed per IP. Server-side calls from the web proxy (no XFF, 127.0.0.1) share one bucket with every other loopback caller. See web W1: anyone can use up the 60/min profile bucket and make every /u page fail open. Suggest a separate key for the internal web caller (loopback + trusted header) or a higher cap for it. |
| B2 | Info | Sage | With TRUST_PROXY=true, clientIp trusts the first XFF entry. That is safe only behind a proxy that overwrites XFF; Caddy does (verified live). Document it in SIGNOFF. |
| B3 | Info | Sage | The renderer peak is about 52–71 MB, not "far below 64 MB". It is bounded and fine. |
| B4 | Info | Sage | Existing vs unknown handles differ by about 0.1 ms; existence is public anyway. |
| B5 | Info | Sage | /copy/wallet/%2e%2e returns 404, not 501, with no side effects. |

## Deploy (17:00 Tehran)
Live as `releases\4c5845b-85377f4`, PID 12428. The first attempt hung at startup and was rolled back; the second was clean. See vps-deploy-log.md.

| B6 | Low | Sage | The API awaits `market.refresh()` (a year of RPC history, 15 s timeout per request plus retries) before `listen()`. A slow RPC means minutes of 502 on restart (seen at 16:44). Listen first and load prices in the background, or cap the boot fetch at about 30 s. |
