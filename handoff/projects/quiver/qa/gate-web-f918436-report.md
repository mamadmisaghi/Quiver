# Gate — web f918436 (Wren M3.6.1 + Safety fix) — PASS

Paired with backend 8c6e455. Covers dfe95b7 plus f918436.

## Static checks
typecheck, eslint --max-warnings 0, npm audit 0 and next build all OK. lib/contracts/api.ts is identical to backend contracts/src/api.ts.

## Behaviour (local pair, then the VPS after deploy)
- Guest gets the sign-in prompt and no compile calls. Dev sign-in works, a reload keeps the session, and there is no refresh loop.
- Backtest succeeds on the first try (end = now−2m, clamps and reruns once on "future").
- Paper run streams over SSE. Stop holds "Stopped" for 32s and the activity log is frozen. Idempotency keys are unique.
- Hero says "$200 of NVDA" and "$500" is gone.

## #safety anchor
- **Finding for Wren (dfe95b7), RESOLVED in f918436:** the Safety section was not rendered on /, so the header and footer `/#safety` links had no target. f918436 renders `<Safety />` (id=safety, EXAMPLE_POLICY).
- Direct load of /#safety: top=80 at 360/390/768/1440. Header link click: OK at 768 and 1440. Footer link click: OK at all 4 widths.
- Content renders $250, $1,000 · min swap $15.63 and 1% (screenshots footer-safety-*.png). innerText missed some values before scrolling; this is an off-screen rendering artefact, and textContent and the screenshots are correct.
- No horizontal overflow on /, /app or /app/markets at any width. No page errors.

## Lighthouse (local; JSON in qa/lh/f918436)
| page | mobile P/A/BP | desktop P/A/BP |
|---|---|---|
| / | 93/96/79 | 100/96/79 |
| /app | 95/100/79 | 100/100/79 |
| /app/markets | 94/100/79 | 100/100/79 |

Best-practices 79 comes only from is-on-https and redirects-http (environmental, plain-HTTP preview). Mobile LCP is 1.8–2.5s, CLS ≤0.033.

## P3s (Wren)
1. Header nav is `hidden md:flex` with no mobile menu, so phones (360/390) have no header Safety link. The footer link works. Likely pre-existing.
2. Go-live confirm: cap and slippage edits are display-only and are not sent to prepare.
3. a11y: a `<dl>` holds elements other than dt/dd groups (accessibility 96 on /).
