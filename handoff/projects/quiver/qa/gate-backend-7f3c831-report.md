# Gate — backend 7f3c831 (Sage M3.6.2) — PASS

## 0. Is the hardened code path the one the VPS actually uses? Yes
- Sage's `.data/dev-store.json` is only the default. main.ts:33 uses `process.env.QUIVR_DEV_PERSIST_PATH ?? ".data/dev-store.json"`, and the VPS api-start.bat sets `QUIVR_DEV_PERSIST_PATH=C:\sites\quiver\data\state.json`.
- Both go through the same `new FilePersistence(store, o.persistPath)` at app.ts:63, which is the class that was rewritten. The old crash site, sync `renameSync` in a timer at persist.ts:42, is gone; timer saves are now async with retries.
- On the VPS the startup log reports `dev persistence on … path: C:\sites\quiver\data\state.json` under the 7f3c831 release.

## 1. Static checks
vitest 204/204 (25 files); forge 54/54; tsc (root + contracts) clean; lint clean; npm audit 0.

## 2. Lock / EPERM / EBUSY / read-only
Real Windows locking isn't available on the Linux box, so I tested with injected fs errors and real permission errors. Probes are in qa/poc/robin-m362.test.ts, 10/10 PASS.
- **Held-lock simulation:** rename throws EPERM 12 times, which spans 2 full saves of 5 attempts each.
  - Both failed saves resolve false, with no throw.
  - The 3rd save succeeds, the file holds v1 and v3 (nothing lost), the failure counter is 2, and no .tmp is left.
- **EBUSY** on mkdir, write and rename, each failing twice: save succeeds.
- **Real read-only directory (EACCES, uid 1000):**
  - The save fails cleanly.
  - After chmod back, the next save contains the missed change and the new one.
- **Real 0444 file:** async save and flushSync both succeed (POSIX rename semantics).
- **Non-transient error** (EISDIR, the tmp path is a directory): returns false, 0 retries, no throw.
- **Coalesced concurrent flushes:** the last state wins.
- **Real API process** (src/main.ts with persistence on, on :8829):
  - With the data directory made read-only mid-run, 2 sign-ins logged `save failed … code EACCES`. The process stayed up and the API still answered.
  - After the directory was writable again, the next save contained every user. Nothing was lost.

## 3. Leftover .tmp and shutdown
- Unit level:
  - Main file missing plus a good .tmp: recovered, and the .tmp is removed.
  - Main file corrupt plus a good .tmp: recovered.
  - Main file good plus a partial .tmp: the main file is used and the .tmp removed.
  - Both bad: returns false, no throw.
- Real process:
  - Booting with a corrupt state.json and a good .tmp logged "recovered from leftover temp file". Re-login kept the same user id and all 6 users were present.
  - SIGTERM sent straight after a write, inside the 500ms debounce window: flushSync saved it.

## 4. The process guard does not swallow other errors
Tested with a real process (qa/poc/guard.ts):
- PersistError: suppressed, process stays up.
- EPERM with a persist.ts stack: suppressed, process stays up.
- Ordinary rejection: crashes (exit 1).
- EPERM from anywhere else: crashes (exit 1).
- Sync throw: crashes (exit 1).

The guard only hooks `unhandledRejection` and rethrows everything else.

## 5. Diff 8c6e455..7f3c831
19 files, +288/−39:
- persist.ts hardening, plus a guard call in main.ts and the flushSync stop in app.ts;
- $500 → $200 in fixtures, demo compile and seeds, with test expectations updated to match;
- persist.test.ts added.

All in scope, and nothing touches auth, money paths or the policy.

## 6. Integration with web f918436
Run locally (backend with persistence on and mainnet-readonly prices) and on the VPS after deploy:
- guest prompt, sign-in, reload with no refresh loop;
- backtest succeeds on the first try;
- paper run, and stop holds "Stopped" for 32s;
- no ≥400 responses, and 0 save failures logged.

## Findings
- **P3 (Ops, Windows):** `schtasks /end` hard-kills the process, so SIGTERM never fires and flushSync can't run. Up to about 2s of changes since the last save can be lost when the task ends. A graceful stop (Ctrl-C/SIGINT wrapper) would close the gap.
- **P3 (Sage):** on load, a *complete* .tmp that is newer than a still-valid main file is discarded. That's the crash-between-write-and-rename case, so the last save is lost. Possible fix: prefer whichever file has the newer `savedAt` when both parse.
- **P3 (QA tooling, Robin):** the g7e UI script leaves its paper run active, and there's no admin or ops route to stop runs for unknown dev labels. Possible fix: a dev-only ops stop route in mock mode, or have the script save its label.
