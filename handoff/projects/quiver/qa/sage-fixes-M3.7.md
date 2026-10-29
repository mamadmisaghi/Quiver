# Sage fixes: M3.7 + M3.8 (backend on 7f3c831)

Commits: a51a657 (M3.7), 5114786 (M3.8). Results: vitest 223/223 (27 files), forge 54/54, typecheck, lint and fixtures:check (15 generated files are deterministic) all green.

## M3.7: Robin's P3s
1. On load, a newer .tmp now wins. `savedAt` is monotonic. A valid .tmp that is strictly newer (or a corrupt main) is promoted over main. `loadedFrom` is exposed. 5 unit tests.
2. Graceful shutdown on SIGINT, SIGTERM, SIGHUP and SIGBREAK (console close). The order is stop runs, flush, close server, exit 0. A watchdog exits 1 if that hangs. `POST /v1/ops/shutdown` needs `OPS_TOKEN` (min 32 chars, timing-safe compare, 30/min/IP). OPS.md has the Windows stop procedure. `scripts/ops/stop-api.ps1` calls the route, waits for the port to close, and only then falls back to `schtasks /end` (a hard kill, so no flush).
3. `GET /v1/ops/runs?status=active|all` and `POST /v1/ops/runs/:id/stop` (idempotent, audited). They only work in mock/testnet with NODE_ENV not production, and never on chain 4663 or live runs. With OPS_TOKEN unset, every ops route returns 404.
4. The rg check found $500 in api-contracts.md and fixed it to $200. gen-ext-fixtures is deterministic now (seeded ids plus DEV_LOGIN), and `fixtures:gen:check` is part of fixtures:check.

## M3.8: Weft sections
| Section | Before | After | Web mocks it |
|---|---|---|---|
| Landing: venues/trades | static lib/mock | GET /public/landing | yes, swap it |
| Landing: signal tiles | static, overclaimed | /public/landing (Earnings, Premium and Volume are supported:false) | yes, swap it |
| Landing: featured strategies | static | /public/landing featured (top 3) | yes, swap it |
| Landing: equity + run-event demo | static | /public/landing preview (7d synthetic backtest) | yes, swap it |
| Settings / limits | ext-mock | GET /settings | yes, wire it |
| Stop all runs | ext-mock | POST /runs/stop-all | yes, wire it |
| Shareable result card | ext-mock | GET /runs/:id/card | yes, wire it |
| Alerts/notifications | ext-mock | settings.alerts.configured=false (ALERTS_PROVIDER placeholder) | label it "coming soon" |
| Autopilot, films, AI refine, approvals, partial close | ext-mock | not built | hide it or label it "coming soon" |

## Wren
- Re-sync web/lib/contracts from backend contracts v1.2 and the fixture copies (they still show $500).
- Replace the landing lib/mock data with /public/landing and show `notice`.
- Wire settings, stop-all and card.

## Robin
- Set OPS_TOKEN (32+ chars) on the VPS.
- Deploy 5114786.
- Stop run_01M5Z5Z4HNP5DNHYYQDD with `POST /v1/ops/runs/:id/stop`.
- Use stop-api.ps1 instead of schtasks /end.
