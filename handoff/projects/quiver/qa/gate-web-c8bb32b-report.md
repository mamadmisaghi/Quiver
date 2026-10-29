# Gate: Quiver web c8bb32b (on 5f18d0e on dd9d25f), backend 19e4ba1 — **PASS**
Gated by Robin, 2026-10-27 (Asia/Tehran). Isolated /tmp copies, own ports (4620 proxy on non-localhost http origin 172.30.0.2, 4621 next, 8817 API), own PIDs only (all killed after).

## 1. Static
- typecheck OK · eslint `--max-warnings 0` exit 0 · `npm audit` 0 vulns · `next build` OK.

## 2. 5f18d0e P2s
| Check | Result |
|---|---|
| Signed-out /app/new: no compile call, shows Sign in | PASS — 0 compile calls, "Sign in to save drafts…" |
| Stop → Stopped immediately, late events dropped | PASS — Stopped <1s, still Stopped +32s, activity unchanged |
| 11th stream → "Limit reached" + notice under title | PASS — "You have 10 live views open. Close a tab to watch this one. Retrying shortly…" |
| LCP (Lighthouse, load <1) | PASS — / 2.0s (perf 98), /app 1.8s (95), /app/markets 1.8s (95); CLS ≤0.033 |
| 0 lint warnings | PASS |
| No 401 console noise | PASS — only one console.info per load |

## 3. Insecure-context fix (http non-localhost; isSecureContext=false, randomUUID undefined)
- UI sign-in PASS (28-char dev label) · compile PASS · backtest PASS (+0.01%, Sharpe 0.17) · paper run with SSE PASS
- Reload keeps session: 0 /auth/refresh, 1 exchange; 20s later still 1 auth call → no refresh loop.
- randomHex: randomUUID → getRandomValues → Math.random only as last resort (code review). Dev label randomness fine for a paper preview.
- Idempotency keys: unique, 32 hex chars.
- Console: single info line "[quiver] insecure context: refresh cookie unavailable, session is in-memory only".

## 4. Regression sweep (live mode, signed in, 1440 & 390)
/, /app, /app/new, /app/strategies, /app/markets, /app/skills, /app/traders, /app/wallets, /app/risk, /app/rewards, /app/revenue → all 200, no horizontal overflow, no page errors, no /v1 ≥400. /app/nope → 404 (expected; only console error). Shots: shots/robin/c8bb32b/sweep-*.png.

## 5. Diff dd9d25f..c8bb32b
9 files, +114/−61 (AppShell, Builder, LiveRun, demo.ts, index.ts, live.ts, mock.ts, EdgeComets, FlightField). No remaining randomUUID call sites; no signing/keys/tx paths added.

## Notes (non-blocking)
- On plain http the session is in-memory only (no refresh cookie) — by design for the preview; HTTPS will restore cookie refresh.

**Verdict: PASS → web-only redeploy to :8091 approved under the existing scope.**
