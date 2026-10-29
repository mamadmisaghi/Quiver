# Gate: web 0614d21 against backend aaa21a4. Robin, 2026-10-28 (Asia/Tehran, UTC+3:30)

**Verdict: PASS.** W1 through W4 from gate-web-b745156 are fixed, and the ?idea= auto-compile fix holds.

## Setup
- A fresh `git archive 0614d21` in /tmp/robin-g06w.
  - lint, tsc and `npm audit` (0) are clean.
  - Built with `PUBLIC_BASE_URL=http://91.107.243.172:8091`.
  - The env matches the VPS: `NEXT_PUBLIC_API_MODE=live` and `NEXT_PUBLIC_API_BASE=/v1` (relative).
- Backend aaa21a4 runs in mock mode on **127.0.0.1:8987**, so the "QUIVER_API_INTERNAL unset" default base gets real use. A proxy on :4642 sends /v1 to the API and everything else to Next on :4643.

## Fix checks
| # | Check | Result |
|---|---|---|
| W1 | /c/[token] with QUIVER_API_INTERNAL **unset** | Card renders, OG 200 (PNG, 58 KB). Revoke: gone. |
| W1 | Same with QUIVER_API_INTERNAL set (`http://127.0.0.1:4642/v1`, `http://127.0.0.1:8987/v1`) | Renders, OG 200. |
| W1 | QUIVER_API_INTERNAL pointing at a dead port | Page shows "unavailable", with no crash and no leak. This proves the env var is actually used. |
| W2 | og:image / twitter:image | Absolute: `http://91.107.243.172:8091/c/<token>/opengraph-image?…`. |
| W3 | /leaderboard with no JS (curl, and Playwright with JS off) | Ranked rows are present (@demo_okafor, @demo_lena…), plus the synthetic-prices notice. |
| W4 | Page opened on an already-stopped run | 1 ticket in 20 s: the single initial connect, then none (b745156 made about 6). |
| W4 | Run stopped while its page is open | 0 tickets in the 20 s after the stop. |
| idea | ?idea= signed in, 5 loads | **0** compile POSTs; prompt prefilled each time. |
| idea | ?idea= as a guest | Prefill only. Compile happens only after the user clicks "Sign in" (SignInButton onDone → run). That's an explicit action and fine. |
| idea | Plain /app/new signed in | Still auto-drafts the sample prompt once. This is pre-existing behavior and not in scope. |

## SSRF / QUIVER_API_INTERNAL review (code)
- `serverApiBase()` reads only env: QUIVER_API_INTERNAL (http/https only), then an absolute NEXT_PUBLIC_API_BASE, then the default `http://127.0.0.1:8987/v1`. No request data, header or host reaches it.
- The card token must match `^crd_[A-Za-z0-9_-]{8,64}$` and is passed through `encodeURIComponent` before it goes into the path, so path traversal or host injection isn't possible.
- The leaderboard fetch uses fixed query parameters and a 4 s timeout.

## Low findings (not blocking)
- **L1:** /leaderboard is prerendered at build with `"use cache"`. If the API is down at build time, the cached value is `null`, so the noscript note shows with no rows until the first revalidation.
  - Locally the rows appeared about 2–3 min after start: no rows on the 1st and 2nd requests (~60 s apart), rows on the 3rd.
  - On the VPS the API is up during the build, so this is mitigated.
- **L2:** The g1 live-approval sub-check didn't produce a new approval within 60 s. The API's own approval count also stayed at 1, so the cause is the backend trigger timing in this harness script (forMinutes and cooldown weren't set). It is not a web issue.

## Regression
- g1 (UI) results:
  - Instruct: proposal shown, no apply before the click, version 1→2 after the click.
  - A stopped run gives a clear 409 message.
  - Share and revoke: API 404 after revoke.
  - Card cache headers are private/no-store.
  - 0 overflow at 360/768/1280 on the leaderboard and card pages.
  - No wallet calls.
- Card HTML contains only the owner's public dev handle (plus RSC `$n` refs), the same as before.
- Lighthouse scores (perf / a11y / best practices / SEO):

  | Page | Perf | A11y | BP | SEO |
  |---|---|---|---|---|
  | / | 93 | 100 | 100 | 100 |
  | /leaderboard | 99 | 100 | 100 | 100 |

- Diff b745156..0614d21 (9 files): new lib/server-api.ts, metadataBase in layout, public-card using serverApiBase, server-side initial leaderboard with a noscript note, Builder ?idea= prefill only, live.ts setting `ended` on stopped/aborted or a 4xx other than 401/429, plus the docs. No package changes.

Artifacts: qa/shots-0614d21/, qa/poc/f2.py and f3.py (run with /tmp/robin-g06-run/ui.py). All local PIDs are killed.
