# Gate: web 4ab4ad6 (Wren, after 2487f2e). Verdict: PASS with one Medium (docs claim)

All times are Asia/Tehran, 2026-10-28. Fresh copy /tmp/robin-g4abw (git archive 4ab4ad6), built with PUBLIC_BASE_URL and QUIVER_API_INTERNAL set; local stack = backend bcfb936 mock (8997) + next start (4653) + proxy (4651). Screens: qa/shots-4ab4ad6/.

## Static
lint 0, tsc 0, build 0, npm audit 0 vulnerabilities. Diff 51209b8..4ab4ad6: 6 files (AutopilotView, globals.css, app/privacy, terms anchor, AppShell, CommandPalette, PARITY.md).

## Browser checks
| Check | Result |
|---|---|
| 360/768/1024/1440 on /, /leaderboard, /docs, /terms, /app, /app/new, /app/markets, /app/strategies, /app/autopilot, /app/portfolio, run page | 44/44 load 200, no horizontal overflow (scrollWidth = viewport). Console clean except 429s from my own test volume at 1440. PASS |
| Tables stack below 1280 | `.rtable` card layout at max-width 1279px; checked at 1024 shots. PASS |
| ⌘K open | Ctrl+K and Meta+K open; sidebar Search button + Enter opens; focus lands in combobox. PASS |
| ⌘K keyboard | typing filters, aria-activedescendant tracks, Arrow keys move aria-selected, Enter navigates (autop → /app/autopilot), Escape closes, focus returns to the opener. "Build: …" goes to /app/new?q=… and pre-fills the builder. PASS |
| ⌘K signed out | Shows only static pages/actions; no strategies, no account data, zero /v1 requests at 1440 and 360. PASS |
| /privacy | lands on /terms#privacy (200), #privacy section visible. PASS |
| Kill-reason copy / enabled:false punctuation | Reviewed in code: typed Record<ErrorCode> map + KILL_EXTRA, raw code kept in title/data-reason; trailing punctuation normalised. Not re-forced live this round |
| Lighthouse (perf/a11y/BP/SEO) | / 92/100/100/100, /leaderboard 98/100/100/100, /docs 99/100/100/100 |

## Findings
- **Medium (docs, not code)**: PARITY.md line 40 says "Refine a draft in plain English | done (builder refine + paper-run instruct)". End to end in the browser, after drafting the builder shows **"COMING SOON – Refine a draft in place. For now, edit the idea above and draft again."** No refine input is wired (`run(instruction)` is unreachable). Backend /compile does accept baseStrategy+instruction, so it's web-only. The UI is honest, so not a deploy blocker, but PARITY.md must be corrected (or refine wired) before anyone relies on it.
- **Low (a11y)**: the palette has aria-modal but no focus trap: two Tabs move focus out of the dialog to the page behind. Escape still works while focus is inside.
- **Low**: CommandPalette swallows api.strategies() errors silently (fine signed out, but no hint when signed in and the call fails).
