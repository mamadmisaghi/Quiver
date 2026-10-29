# Robin gate — Quiver web dd9d25f vs backend 19e4ba1 — **PASS** (0 P0, 0 P1, 6 P2)
Date 2026-10-27 (Asia/Tehran). Isolated /tmp worktrees with `npm ci`. Own ports: backend 8806, fault proxy 8807, web live 4426, web mock 4427. Only my own PIDs were killed. No deploys, no VPS changes, no transactions, no secrets.

## 1. Checks
- zod pinned to 4.6.7. config.ts was synced as-is. `tsc --noEmit` exit 0. `npm audit`: 0 vulnerabilities.
- `eslint .`: 0 errors, 3 warnings, all `no-unused-expressions` (src/motion/EdgeComets.tsx:67,68 and FlightField.tsx:53). Cosmetic. → Wren P2.
- `next build` passes in both live and mock. All 18 routes are static.

## 2. Sweep
15 pages × 1440/768/390 × mock/live/live-signed-out at DPR 2: 135 shots in shots/robin/dd9d25f/, data in qa/sweep-dd9d25f.json.
- **Layout:** horizontal overflow 0 on every page. Text under 12px: 0, so the nav-label fix is confirmed. No page errors. No undefined/NaN/null text. Every input is labelled and every image has alt text.
- **Unnamed links:** "/" shows 6 links/buttons with no accessible name. This is a false positive: the links have text, but it reads empty while the reveal animation is still hidden. Lighthouse a11y on / scores 100.
- **Console:** the only messages are expected network ones: 401 `/auth/refresh` when signed out, 404 for an unknown run, and the 404 page itself.
- **Markets tabs:** tablist/tab/tabpanel are present, `aria-selected` is correct, and ArrowRight and End both work.

## 3. P0 and P1 probes
- **P0 unknown price source: PASS.** The proxy rewrote all 10 `priceSource` values to `pyth_future_xyz`. Markets rendered fully with a generic "Price source" label and no throw.
- **P1 run ids: PASS.** In live mode, `foo` and a stale fixture id both show "Run not found" with ways out. `demo` auto-starts a paper run. A real run id streams.
- **P1 signed-out Sign in: PASS, with one gap.**
  - Sign in is present on all /app screens, including run, foo and demo in LIVE mode.
  - **Gap: /app/new has no Sign in button.** It also auto-POSTs /compile on load. Once the anonymous IP limit was used up, it showed "Too many requests". → **Wren P2.** Add Sign in to /app/new, and don't auto-compile for signed-out visitors (it wastes the anon quota).
- **P1 Markets error and retry: PASS.** With the backend dropped, the page shows "Couldn't load markets." and a "Try again" button. After restoring the backend and clicking it, the data loaded.

## 4. Backend-error copy and SSE
| Case | Result |
|---|---|
| 422 future range (body forced to 2026-12…2027-01) | "The range ends in the future. Backtests can only run up to Oct 27, 2026." plus a "Use the allowed range" button. Clicking it reran the backtest, which completed. |
| 6th run, 429 | "You have 5 paper runs going. Stop one to start another." |
| 11th stream, 429 (10 held open via API) | "You have 10 live views open. Close a tab to watch this one. Retrying shortly…" It recovered by itself once they were released. |
| 404 page | Branded 404 with "Go home" and "Open the app". The API returns 404 for unknown routes. |
| SSE reconnect, multiple tabs, stop | Two tabs and a reload all stream with single-use tickets. Stop moves both tabs to Stopped. |

- **P2 (Sage/Wren):** after "Stopped · stopped by user" (17:45:05), one more "Checked signals" event arrived at 17:45:08. Also, the "Live" and "Watching" badges stay up after the run stops.
- **P2 (Wren):** on the 11th stream, the 429 copy sits below the fold while the header reads "Connecting…". Put the copy in the Activity header.

## 5. Lighthouse, mobile, live, 5 runs each (qa/lh/dd9d25f/)
| Page | LCP median | LCP worst | CLS max | Perf | A11y |
|---|---|---|---|---|---|
| / | 2.10s | 2.45s | 0.002 | 97–99 | 100 |
| /app | 2.11s | 2.54s | 0 | 96–99 | 100 |
| /app/new | 2.40s | 2.80s | 0.001 | 92–98 | 100 |
| /app/markets | 1.96s | 1.96s | 0.033 | 98–99 | 100 |

- Every median is ≤2.5s, so this passes. Wren's claims hold: / at 2.1s, and /app/new at 2.2s is close to my 2.4s median.
- **P2 (Wren):** the /app/new worst run is 2.8s and the /app worst is 2.54s. Tighten these.

## 6. Diff 2c52ff0..dd9d25f
- 45 files. The bulk is package-lock (eslint devDeps).
- New: lenient-contracts.mjs (post-sync, makes the source schemas accept any string), not-found.tsx, SignInButton and Loading.
- restart.sh only gains a comment. It still kills only the PID listening on :4317. sync-contracts.sh calls the new lenient script.
- .env.example contains no secrets. The secret grep found nothing.
- Nothing unexpected.

## Verdict
Web dd9d25f **PASS**. Together with backend 19e4ba1 (PASS), **Quiver as a whole passes for a devnet/paper preview.** The P2s above are not blocking.
