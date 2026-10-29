# Gate: backend e0383b0 (M4.6) — Robin, 2026-10-28

**Verdict: PASS. Deployed with web 5eb7d5b to the VPS at about 10:20 Asia/Tehran (UTC+3:30).**

## Standard checks (fresh git-archive copy /tmp/robin-ge03)
- vitest 353/353 (38 files), forge 54/54, tsc, lint, fixtures:check (30 files) and npm audit 0 are all clean.
- The diff (17 files, +285/−67) is additive on 8e93197:
  - `/positions` and `/runs/:id/positions`;
  - approval strategyName and actionTitle;
  - autopilot strategy names;
  - structured 409 details;
  - a config refine.

## M4.6 focus (probe: `qa/poc/robin-ge03-m46.test.ts`, 3/3 pass)
- **IDOR:** user B gets 404 on user A's run from both `/runs/:id/positions` and `/positions?runId=`.
  - The response is byte-identical (apart from requestId) to the one for a nonexistent id, so run ids can't be enumerated.
  - `/positions?mode=paper` for B returns an empty list, and A's strategy name never shows up for B.
  - The code checks `ownerId` on both routes and filters live runs by owner and mode. The same results hold on the VPS: own 200, foreign 404, fake id 404, B's list empty.
- **409 details:** built only from the caller's own run, found by `findApv`, which filters by owner. The fields are runStatus, plus haltReason only when the run is halted.
  - Another user posting to the same approval id gets a plain 404 with no status.
  - Autopilot names come from strategy ids that PUT /autopilot already checks for ownership, so they can't leak another user's names.
- **Config:** these values are rejected at startup:
  - SK_DEFAULT_EXPIRY_HOURS greater than MAX;
  - DAILY below PER_TX;
  - DAILY above 64 × PER_TX.
  - The boundary DAILY = 64 × PER_TX and the defaults are accepted.
  - The VPS's real api-start env loads under e0383b0: `CONFIG_OK 24 168 250 1000`, checked without printing any values.
- **Regression:** the g5d5 PoCs and the g8e9 probe give the same results as on 8e93197: the 9 FINDING assertions still flip (fixed), and 0 new failures.

## Findings
- None new. The four 8e93197 P3s still stand (see gate-backend-8e93197-report.md).
- Ops note: `stop-api.cmd`'s 10 s wait uses `timeout`, which fails under a non-interactive WinRM shell ("Input redirection is not supported"). The graceful shutdown itself worked (log: "graceful shutdown … shutdown complete code 0"), but the wait loop doesn't wait. Suggest `ping -n 2 127.0.0.1 >nul` instead (P3, Sage).
