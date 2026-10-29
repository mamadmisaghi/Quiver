# Gate: backend M5.21 (297d8dd on 85377f4) — Robin, 2026-10-28 (Tehran)

**Verdict: PASS** (0 blockers, 0 majors; 3 info items). Deployed to VPS 17:16–17:20 Tehran.

## Re-run (worktree /tmp/g21 @ 297d8dd)
- tsc, lint, fixtures OK; vitest 68 files **504/504**; forge **54 passed**. "ALL CHECKS PASSED", rc 0. Matches Sage's claim.

## B6: listen first, background warmup
- Local boot, real src/main.ts, mock RPC, WARMUP_MAX_MS=5000:
  - **hang** (RPC never answers): health answered on the first poll (~0.56 s after spawn, tsx compile included) with `ready:false, state:warming` plus a calm notice. During warmup: status 200 (1.6 ms), profile 200, landing 200, market history 200 (0 bars + warmup notice), detail 200 (returns null, `synthetic:true`). At +5.0 s: `ready:true, state:timeout` with a user-readable message. Ops shutdown clean, exit 0.
  - **slow** (4 s then 500): same; timeout at exactly 5.0 s, errors 0, exit 0, 3 RPC calls.
- The health body has exactly `{ok,ready,warmup:{state,startedAt,finishedAt,errors,message},notice}`. Loader error text and the RPC URL are not exposed (PoC). No secrets in logs.
- VPS: listening ~11 s after `/run` (the previous deploy took over 5 min). Warmup `ready` after 17.4 s.

## W1: INTERNAL_PROXY_TOKEN (PoC qa/poc/robin-m521.test.ts, 11/11)
- min 32 / max 256, so a short token fails boot; the error names the variable, not the value. Compared via SHA-256 digests plus timingSafeEqual; the header is capped at 256 characters.
- Bonus (20×, separate `:internal` bucket, 1200/min then 429) only with the correct token **and** a loopback peer (127/8, ::1, ::ffff:127.x). Non-loopback peers, and wrong, short, prefix, suffix, case-changed, comma-appended, 300-char or empty tokens all stay at 60.
- Token never in responses, headers or console. describeConfig redacts it.
- Unset means the header is ignored and the API behaves exactly as before.

## B2: TRUST_PROXY_PEERS
- Default is loopback. XFF from a non-loopback peer is ignored. From loopback it is honoured. `any` keeps the old behaviour, a bad value fails boot, and an empty XFF falls back to the socket address.

## B3
- The memory comment is fixed.

## Regression
- PoCs m515–m521: 75/76. The 1 failure is the m519 snapshot test, which needs SNAP (expected, as before).

## Info
1. `peer === undefined` (in-process requests only, i.e. tests) is treated as a trusted proxy. Unreachable via TCP.
2. After a warmup timeout the original load keeps running alongside the 60 s refresh timer, so RPC calls can overlap on a hanging RPC. Bounded by RPC timeouts; consider a single-flight guard.
3. `ready:true` also means "gave up waiting" (state timeout or partial). Monitors should read `warmup.state`.
4. Header OWS is trimmed, so a token with a leading space is accepted. Same secret, not a weakness.

## Deploy (see vps-deploy-log.md)
- INTERNAL_PROXY_TOKEN **left unset**: web 4eaca8b proxy.ts sends no such header (git grep).
- Caddy reaches the API from loopback only (upstream 127.0.0.1:8987, API bound to 127.0.0.1), so TRUST_PROXY_PEERS stays at its default. Shown live: per-IP limiting still keyed on the client IP from XFF.
- Caddy: `request_header -X-Quiver-Internal-Token` added inside `http://:8091 {` in sites/quiver.caddy only. Validated, graceful reload, Caddy PID unchanged.
- Outside: spoofed token + `XFF: 127.0.0.1` gave 60×200 then 15×429 (sent from the VPS public IP through Caddy), so no bonus. Note: the box egresses from rotating IPs (140.248.52.x), so per-IP limit tests must run from a single-IP host.
