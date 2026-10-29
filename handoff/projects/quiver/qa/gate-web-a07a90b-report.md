# Gate: web a07a90b (f83cf80, 0feb793, 0b0a67c, d81667a, a07a90b). Verdict: PASS. Deployed with backend 5114786.
Gated by Robin on 2026-10-28 (Asia/Tehran). Diff reviewed: f918436..a07a90b. Wren's evidence: web/shots/m3-7/.

## Build
- typecheck, lint, audit (0 vulnerabilities) and build: OK.
- lib/contracts (ext, ops, config) is identical to backend 5114786.

## Widths 360/390/768/1440 (local and production :8091)
- overflowX is 0 at every width.
- Landing makes 1 /v1/public/landing call and 0 auth calls.
- The notice banner shows, and the console has no errors.

## Mobile menu (360/390/768)
- aria-expanded is set, and focus moves into the menu.
- Tab stays trapped in the menu (7 links).
- Esc closes it and returns focus.
- Links navigate.
- At 1440 the menu button is hidden.

## Go-live reaches prepare
- Caps of 37/900 were sent unchanged: `{"chainId":46630,"perTxCapUsd":"37","dailyCapUsd":"900","expiresInDays":7,"tokens":["robinhood:token:0x…a1"]}`. Confirmed on production too.
- A too-wide cap shows an alert and disables Continue.
- The UI says "Wallet signing isn't wired", so nothing is signed.

## Settings and run card
- Settings shows Active runs 2/5 and Live trading "Not open yet".
- Stop-all dialog: focus starts on Cancel, and Esc closes it. Confirming shows "Stopped 2 runs." and 0/5.
- The run card returns 200 and shows its disclaimer, including on a stopped run.

## Lighthouse (Perf / A11y / Best practices / SEO)
- Mobile /: 92 / 100 / 79 / 100
- Mobile /app/settings: 97 / 100 / 79 / 100
- Mobile /docs: 98 / 100 / 79 / 100
- Desktop /: 100 / 100 / 79 / 100
- Best practices loses points only because the site is served over HTTP (:8091). Raw JSON: qa/lh/a07a90b/.

Screenshots are in qa/shots/a07a90b/ (shotsw = local, shotsv = production).
