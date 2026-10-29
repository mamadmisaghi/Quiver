# Gate — backend 9c8f10e (Sage M3.9–M4.2) — FAIL

Slices on top of 5114786: M3.9 6a6314c (session keys), M4.0 6238fa3 (webhook alerts), M4.1 3db8033 (partial close), M4.2 9c8f10e (approvals). Worktree: /tmp/robin-g9c8 (a fresh copy, detached at 9c8f10e). Nothing was deployed, the VPS was not touched, and /tmp/robin-g9be was left alone.

## Checks
- vitest 274/274 (31 files); forge 54/54; tsc clean; lint clean; npm audit 0; fixtures:check OK.
- Robin probes: 29/29 (they assert current behaviour, including findings): `poc/robin-g9c8-m40-ssrf.test.ts` (11), `poc/robin-g9c8-m42-races.test.ts` (18). The plain-Node repro is `poc/robin-g9c8-pin-plain.ts` (`npx tsx`).
- Diff 5114786..9c8f10e: 38 files, +1098/−53, all in scope.

## Diff review
- ssrf.ts:
  - Only https on ports 443/8443 is allowed; userinfo is rejected.
  - The names localhost, .localhost, .local and .internal are blocked.
  - The v4 blocklist covers 0/8, 10/8, 127/8, 100.64/10, 169.254/16, 172.16/12, 192.168/16, 192.0.0/24, 198.18/15 and ≥224.
  - The v6 blocklist covers mapped addresses (dotted and hex), ::, ::1, fc00::/7, fe80::/10, ff00::/8, 2001:db8::/32 and 64:ff9b::/96.
  - DNS is resolved, every answer is checked, and the request is pinned to the checked address.
- service.ts:
  - Redirects are not followed; the response body is discarded.
  - Retries are 10/60/300/1800 s with a maximum of 5 attempts, then the delivery is marked failed.
  - The signature is HMAC-SHA256(secret, `${ts}.${body}`). Receiver guidance (contracts/alerts.ts) says to reject when the timestamp skew is over 300 s.
  - The secret is never logged or returned. Signing happens server-side, so constant-time comparison is the receiver's job.
- app.ts approvals:
  - Lookups are scoped to the owner, there is a cap of 20 pending, and the TTL is enforced.
  - The run's status (paused/halted) is checked before `decideApproval` is queued on the run chain.
- Partial close: paper only, pct in (0,100], dust closes the full position.
- Session keys: ratio 64×, expiry ≤168 h, whole bps with cap ≤ the account cap. Without ALCHEMY_API_KEY, testnet signing returns 503.

## Probes
- SSRF URL matrix, all BLOCKED:
  - localhost forms: localhost, ⓛⓞⓒⓐⓛⓗⓞⓢⓣ, fullwidth dots, .internal, .local.
  - 127 forms: 127.0.0.1, 127.1, 2130706433, 0x7f000001, 0177.0.0.1.
  - IPv6: [::1], [::ffff:127.0.0.1], [::ffff:7f00:1], [::].
  - Metadata and private ranges: 169.254.169.254, 10/172.16/192.168, 0.0.0.0.
  - Other: user@host and @ tricks, ports :22/:80/:6379, http/ftp/file/gopher schemes.
- `LOCALHOST.` (trailing dot) passes the name check, but the system resolver returns 127.0.0.1 and it is blocked.
- An over-long URL passes the shape check but the schema caps it at 2048.
- DNS rebinding: every send re-resolves and checks again. A first answer of public then 127.0.0.1 → blocked, and the connection is pinned to the checked IP.
- Redirect: a 302 to an internal address is not followed (it counts as a non-2xx retry).
- Retries: exactly 5 calls, gaps [10,60,300,1800], then failed. HMAC is checked against an independent computation.
- Approval races (ManualClock plus a blocked chain):
  - Concurrent decisions: approve∥approve → [200,409,409] with 1 fill. approve∥reject → one outcome.
  - Stop and expiry: approve∥stop → 409 canceled, 0 fills. The TTL boundary returns 409. Expiry while queued returns 409.
  - Kill switch: re-checked, 0 fills.
  - Cap: 20 holds under concurrent ticks.
  - Cross-user (IDOR): 404 and an empty list.
  - Restart: the approval is gone (404), nothing executes, and approvalMode persists.
- Partial close:
  - Bounds: 0, >100 and NaN → 422.
  - Sizing: 50% halves the position exactly; 99.99% closes the full position (dust).
  - Access and mode: cross-user → 404, testnet → 403, stopped run → 409, live start → 403.
- Session-key bypass attempts (ratio, expiry, fractional bps, cap above the account cap, negative values, strings) are all refused.
- 503 body: `signing_unavailable` plus requestId, no stack or secret, but the message names `ALCHEMY_API_KEY`.

## Findings
- **P1 — Webhook delivery is broken in production (owner: Sage).**
  - Cause: the `httpsTransport` lookup override always calls `cb(null, address, family)`. On Node ≥20 (`autoSelectFamily` defaults to true; the box runs v24.22.1 and engines is ">=20") `net` calls lookup with `{all:true}` and expects an array.
  - Effect: every hostname webhook fails with `Invalid IP address: undefined`, retries 5 times, then is marked failed. It fails closed, so this is not an SSRF hole, but no alert is ever delivered.
  - Why tests missed it: all M4.0 tests inject a fake transport.
  - Fix: `o?.all ? cb(null,[{address,family}]) : cb(null,address,family)`. Also add one test against a real local TLS server.
  - Repro: `poc/robin-g9c8-pin-plain.ts`; asserted in the m40 probe.
- **P1 — An approval can fill on a HALTED run (owner: Sage).**
  - Cause: the status check runs before the decision is queued. A halt (for example `haltExternal geo_block`) that lands in between still returns 200 filled. The risk re-check in `sim/risk.ts` looks at killSwitch but not `executor.halted`.
  - Fix: check status/halted inside `decideApproval` on the chain, and have the risk gate refuse when halted.
  - Probe: m42 "halt between check and decide".
- **P2 — An approval can fill on a PAUSED run (owner: Sage).** Same race as above, triggered by pause; the same fix covers it.
- **P2 — One slow receiver can stall everyone's alerts (owner: Sage).**
  - Cause: `timeout:5000` is an idle-socket timeout, and `process()` is one global serial loop.
  - Evidence: a receiver that trickles a byte every few seconds kept a delivery pending for over 14 s in the probe (using the fixed transport). That blocks alerts for all users.
  - Fix: add a total deadline (AbortSignal.timeout, about 10 s), a response size cap, and per-destination or concurrent delivery.
- **P3 — SSRF blocklist gaps, hardening (owner: Sage).**
  - Not blocked:
    - IPv6: IPv4-compatible `::7f00:1` (which the URL `[::127.0.0.1]` normalises to), `::ffff:0:a.b.c.d`, the expanded mapped form, 6to4 `2002::/16` (with 127 or 169.254 inside), Teredo `2001::/32`, `fec0::/10`, `100::/64`.
    - Doc ranges: 198.51.100/24, 203.0.113/24.
  - Impact: on this box all of these return ENETUNREACH, so the risk is low, but it depends on the host's network stack (the VPS is Windows).
  - Fix: prefer an allowlist that only accepts global unicast addresses (ipaddr.js `range()==="unicast"`).
- **P3 — Trailing dot `LOCALHOST.` skips the name check.** DNS still blocks it. Fix: strip the trailing dot before the name check.
- **P3 — The 503 signing message names the server env var `ALCHEMY_API_KEY`.** Use a generic message.
- **P3 — Replay guidance has no delivery-id.** Contracts document the 300 s timestamp window only. Add an `X-Quiver-Delivery` id and tell receivers to dedupe on it, since retries resend the same body.
- **P3 — Resolved approvals pile up per run with no limit.** Prune them, for example keep the last N.
- **P3 (pre-existing) — A dev restart restores a paused run as running.**

Verdict: **FAIL** — blocked by the two P1s (alerts never deliver; halted-run fill). Re-gate after Sage's fixes. The P2s should land in the same pass.
