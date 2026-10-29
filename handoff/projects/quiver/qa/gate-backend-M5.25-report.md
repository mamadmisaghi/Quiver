# Gate: backend ab57b1b (M5.25 on top of 5637e10)
Robin, 2026-10-28 20:39–20:46 Tehran (UTC+3:30). **Verdict: PASS, deployed 20:43.** Finding owner: Sage.

## Checks (re-run, output read)
- **No `checks.sh` exists** in the repo at ab57b1b (or anywhere in /workspace/quiver). I ran the equivalent: typecheck 0, lint 0, `fixtures:check` OK (38 files).
- **vitest:** Sage's suite is **544/544 with 0 skipped**. With my 11 PoCs added it's 555/555.
  - The first run showed 4 failed files and 9 skipped. That was only because my worktree had no `foundry/lib`; the anvil tests broadcast to a local anvil only. After linking it, everything is green.
- **forge 59/59.** This matches Sage's 59; the earlier 62 included my 3 scratch tests.

## Verify items
- **Deposit fails closed: OK.** Every RPC failure returns **503 `venue_unavailable`**, `details.reason="recipient_check_unavailable"`. The 503 body leaks neither "unchecked" nor the RPC URL. Failures tested:
  - `TEST_POOL_RPC_URL` unreachable, with the real viem client (8 s timeout) and no injected reader;
  - wrong chain;
  - getChainId throwing;
  - getCode throwing or returning null;
  - a reader with no getCode.

  Also OK:
  - "unchecked" appears only with no RPC configured.
  - A wrong chain stays latched closed. A transient getChainId error recovers to "verified".
  - The 19-dp amount is still 422 with 0 RPC calls. 409 is unchanged.
- **SIGNOFF §9: OK, with Low L1.** It covers the Caddy *overwrite* requirement and says to keep 8787 on 127.0.0.1.
  - The VPS API binds to **127.0.0.1:8987 only**, verified by netstat (web 4517 and PumPals 8090 are loopback too). Outside access to 91.107.243.172:8987 times out.
  - **L1 (Low, docs/hardening):**
    - The backend has no HOST option. `serve()` gets only `port`, so @hono/node-server binds to all interfaces by default.
    - On the VPS, loopback comes from the `bind.mjs` preload (`NODE_OPTIONS` in api-start.bat), and §9 doesn't mention it.
    - §9 also says 8787, but the VPS uses 8987 (because 8787 is Obscura).
    - Recommend a `HOST` config defaulting to 127.0.0.1, and §9 wording of "the API port (8787 default; 8987 on the preview VPS)".
- **JWKS: OK.** The 10 s floor is in both the config (`500`/`9999` become 10000; `0`, `-5`, `abc` and `1.5` are rejected at boot) and the verifier (`1` becomes 10000).
  - **No DoS amplification:**
    - With the interval configured at 1 ms, one random kid per second for 120 s caused ≤ 13 fetches.
    - 200 concurrent random kids after the cooldown caused exactly 1 fetch.
    - A still-unknown kid gives 401 with no second fetch.
    - Good keys are unaffected.
  - The "one-shot refetch" is the existing cooldown + single-flight path. No new fetch path was added.
- **Per-user invalid cap (60) on top of 120/IP: OK.**
  - Valid requests never count. After the per-user 429, a valid request is still 200.
  - Another user on the same IP is unaffected.
  - Rotating XFF with TRUST_PROXY=any doesn't dodge it: exactly 20 of 80 requests got 429.
  - Three users on one IP are still capped at 120 by the per-IP limit.
  - `=0` turns the per-user cap off, and the per-IP cap remains.
  - Note: the deposit route also keeps its own `dep:<user>` 20/min limit.
- **Regressions: none.**
  - The earlier PoC areas are covered by green suites: m524b high-s, m524c JWKS, m524d (now fail-closed), m524e balance, m524f tNVDA, and refunds.
  - The XFF and 19-dp checks were re-done in zz525.
  - Lockfile unchanged.

## Open from earlier (unchanged)
- `Number()` deposit cap edge (1 ETH + 1 wei).
- Per-IP caps depend on Caddy overwriting XFF (Caddy is configured that way).

## Deploy
Recorded in vps-deploy-log.md.
