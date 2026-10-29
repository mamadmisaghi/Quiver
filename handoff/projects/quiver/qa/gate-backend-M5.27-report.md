# Gate: backend M5.27 (f332668) on bb835c1 — PASS (not deployed)
Date: 2026-10-28 ~21:30 Asia/Tehran (IRST). Gate: Robin. Worktree /tmp/gb27 (removed).

## Scope
- f332668 is a direct child of bb835c1 (ancestor check OK).
- 9 files: scripts/checks.sh, test/anvil.ts (new), test/global-forge.ts (new), vitest.config.ts (new), 4 anvil integration tests, api-contracts.md.
- **No runtime change** (nothing under src/ or contracts/src), so there was **no redeploy**. The VPS stays on bb835c1-b76c459 (PID 14080, 127.0.0.1:8987).

## (1) checks.sh
- The FIXTURES_GEN step is removed. Only fixtures:gen:check and fixtures:check run.
- TREE_UNCHANGED snapshots `git status --porcelain --untracked-files=no` plus a sha of `git diff` before and after the run.
- Proofs (local branch robin-m527-proof, reset and deleted afterwards):
  - Stale committed `contracts/fixtures/alerts.rule.json`: FIXTURES_GEN_CHECK and FIXTURES_CHECK FAIL, exit 1. **M5.26 M1 fixed.**
  - Tracked file modified during the run (api-contracts.md at +3s): TREE_UNCHANGED FAIL, exit 1.
  - Clean tree: ALL CHECKS PASSED, exit 0.
- Low L1: a tracked file that is already modified when checks.sh starts does not trip TREE_UNCHANGED, because only changes made during the run are compared. That matches the stated intent ("changes while it runs"). Optional hardening: fail if `before` is non-empty.
- Info: untracked files are excluded by design (`--untracked-files=no`), so they are not detected. A new untracked file gave exit 0.
- /workspace/checks.sh matches in intent. It differs only in a hard-coded `cd /workspace/quiver/backend` and the forge path, so it always runs against the main checkout, not a worktree.

## (2) Anvil
- test/anvil.ts gets an OS free port (listen 0 on 127.0.0.1) and confirms that eth_chainId returns our chainId from our live process. It retries 3 times and kills the child on failure.
- globalSetup runs `forge build` once. The per-file forge build calls were removed.
- Root cause confirmed: m50 and m523 both used 18547.
- Grep: no fixed anvil ports remain (18545/6/7 are gone). The remaining 8545 and 8987 hits are SSRF and ops fixtures.
- checks.sh plus 6 full vitest runs: all passed, 81 files and 548 tests each time, 0 skipped, 0 flakes. 0 anvil processes were left after every run (baseline 0; nothing killed).
- Info: anvil is spawned via top-level await at module load, before afterAll registers. No orphans were seen in practice.

## Verdict
PASS. No deploy needed. VPS unchanged.
