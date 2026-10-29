# Gate: backend bb835c1 (M5.26 on top of ab57b1b)
Robin, 2026-10-28 20:59–21:07 Tehran (UTC+3:30). **Verdict: PASS, deployed 21:04.** One Medium finding (tooling only, not runtime). Owner: Sage.

## checks.sh (committed, run, output read)
- **Run at bb835c1:** `scripts/checks.sh` reported TC, LINT, FIXTURES_GEN, FIXTURES_GEN_CHECK and FIXTURES_CHECK ok.
  - **VITEST 81 files, 548/548** (0 skipped).
  - **FORGE 59/59**.
  - `ALL CHECKS PASSED`, exit 0, and no tracked files changed.
- **Exits non-zero on a failing test: OK.** I injected a failing unit test; the result was `VITEST FAIL`, `CHECKS FAILED`, exit 1.
- **MEDIUM M1: fixture drift passes.**
  - `FIXTURES_GEN` runs `fixtures:gen` (which writes files) *before* `fixtures:gen:check`, so the check is vacuous.
  - Proof: I made a local scratch commit with a stale `contracts/fixtures/alerts.rule.json` (never pushed; worktree reset). The result was `ALL CHECKS PASSED`, **exit 0**, and the script silently rewrote the file. The only trace is a ` M` line from `git status`.
  - Fix: drop the FIXTURES_GEN step, or fail when `git status --porcelain --untracked-files=no` isn't empty.
- **Info I1:** `m50-anvil-readonly` failed once out of 5 full-suite runs (all 4 tests). It passed 3/3 in isolation and on every other full run. It's a pre-existing timing flake, not M5.26.

## Bigint caps: OK
- **Deposit:** compares parseUnits base units against parseUnits(cap). Results:

  | Amount | Result |
  |---|---|
  | ETH `1` | 200; amountBaseUnits 1e18 |
  | ETH `0.999…999` (18 dp) | 200 |
  | ETH 1 wei | 200 |
  | ETH `1.000000000000000001` | 422 (was 200 with `Number()`) |
  | ETH 19 dp | 422 too_many_decimals |
  | ETH max 16-digit `9999999999999999.99…` | 422 |
  | `0` | 422 |
  | tUSDG `1000000.000000` | 200 |
  | tUSDG `1000000.000001` | 422 |
  | tUSDG 7 dp | 422 |
  | tNVDA `10000` | 200 |
  | tNVDA `10000` + 1 wei | 422 |
- **Swap (quote and prepare):** I used *real* decimals (tUSDG 6, tNVDA 18). Sage's m526 fake uses 6 for both tokens, so the 18-dp sell path was only covered by mine.
  - Buy cap 1,000,000 tUSDG: exact 200, +1 unit 422.
  - Sell cap 10,000 tNVDA: exact 200, +1 wei 422.
  - `9999999999999999`: 422.
  - 19 dp sell: 422.
- **Negative, huge or junk input:** `-1`, `-0.5`, `1e3`, `0x10`, ` 1`, `1.`, `.5`, `01`, `+1`, 17 digits, 400 digits, `Infinity`, `NaN`, and JSON numbers or null all get 422 from the AmountStr schema with **0 pool reads**. The regex caps the integer part at 16 digits, so there's no BigInt blow-up and no negative value reaches the cap code.

## HOST: OK
- Config defaults to `127.0.0.1`. An empty `HOST=` or a comment-only value also falls back to loopback, because loadConfig drops empty values. `0.0.0.0` applies only when explicitly set.
- `listenOpts` passes `hostname` to serve(), and the boot log prints the host.
- Documentation:
  - `.env.example` reads "default 127.0.0.1 (keep loopback behind Caddy)".
  - SIGNOFF reads "Never set `HOST=0.0.0.0` on the VPS".
  - Minor: neither describes 0.0.0.0 as an opt-in for containers or LAN use, but it's clearly not a default.
- The VPS machine environment has no HOST or NODE_OPTIONS (checked with reg query).

## SIGNOFF §9: OK
It covers HOST replacing bind.mjs and the VPS procedure. The `PORT` row reads "8987 on the VPS (default 8787 local dev)", and the XFF paragraph now names 8987.

## Regressions: none
- Sage's suite is green, covering the M5.22–M5.25 PoC areas (high-s, JWKS, fail-closed, insufficient_balance, tNVDA, refunds, per-user cap).
- My zz526 tests: 4/4.
- Lockfile identical.

## Deploy
Recorded in vps-deploy-log.md.
