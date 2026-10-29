# Gate: web b745156 (403f304 + b97f752 + b745156) — **FAIL (deploy held)**

Gated 28 Oct 2026, around 10:30–11:00 Tehran time (UTC+3:30).
- Fresh copy: /tmp/robin-gb74w.
- Local stack: proxy :4642, API aaa21a4 on :8838, Next on :4643.
- Flows: `qa/poc/g1.py`, `g1a.py` and `og.mjs`. Screenshots are in `qa/shots-b745156/`.

## Standard checks
- npm ci, lint, tsc, audit 0 and build: all OK.
- The contracts match aaa21a4 except `common.ts`, which is the known lenient diff.

## Blocker
### W1 (high): /c/[token] is broken with the current deploy config
- `lib/public-card.ts` fetches on the server from `QUIVER_API_INTERNAL ?? NEXT_PUBLIC_API_BASE`.
- The release `.env.production.local` (and the VPS copy) has `NEXT_PUBLIC_API_BASE=/v1`, which is relative, so the server-side fetch fails. `web-start.bat` doesn't set `QUIVER_API_INTERNAL`, and the variable isn't documented anywhere in the repo.
- Result: every valid shared card shows "Couldn't load this card", and the OG image says "card not available" (seen locally with the same config).
- With `QUIVER_API_INTERNAL=http://127.0.0.1:<api>/v1` set, the page and the OG image render correctly.
- **Fix:** either set and document `QUIVER_API_INTERNAL` (deploy: add `set QUIVER_API_INTERNAL=http://127.0.0.1:8987/v1` to `web-start.bat`), or fall back to an absolute internal URL in code.

## Other findings
- **W2 (medium):** there is no `metadataBase`, so `og:image` and `twitter:image` are absolute `http://localhost:<port>/...` URLs. Social previews of cards will never load. Set `metadataBase` from a SITE_URL env.
- **W3 (low):** /leaderboard with JS disabled shows only the heading, the tabs and "Loading leaderboard", with no rows. It is a client-only fetch; SSR or a `<noscript>` note would fix it. No private data is shown either way.
- **W4 (low):** an open page of a stopped run requests a new stream ticket about every 3 s (6 in 20 s), reconnecting forever.

## Checks that passed
- **Instruct never applies without a click.** After asking, the proposal is shown, the strategy is still v1, and no apply POST is sent. Clicking Apply makes it v2 and shows "applied".
- **Stopped-run 409** (Wren's open case): the run was stopped while the page was open, with the stream blocked to simulate lag. The panel shows "The run has stopped, so it can't be changed." Normally the panel hides as soon as the stream reports the stop.
- **Live approval_requested** (Wren's open case): the page opened with 0 approve buttons. The approval arrived over SSE about 60 s later and the Approve button appeared without a reload.
- **Share and revoke UI:** Share → URL and Copy → Revoke → confirm. Afterwards the page shows "This card isn't shared" and the API returns 404.
- **Card page:** served `private, no-store`, with `noindex`. Its HTML has no run, user or strategy ids and no USD (the only `$N` matches are React internals).
- **OG image:** percentages, trades, duration and the disclaimer; no ids and no USD. Served `max-age=0, must-revalidate`.
- **Widths:** no horizontal overflow at 360, 768 or 1280 px on /leaderboard or /c.
- **Lighthouse:**
  - /leaderboard: performance 91, accessibility 100, best practices 100, SEO 100.
  - /c: performance 87, accessibility 100, best practices 100, SEO 91 (SEO is lower only because of the intentional `noindex`).
- **No wallet signing:** 0 eth calls.

## Verdict
**FAIL** on W1, because the main page of the share feature doesn't work as the pair would be deployed. The backend aaa21a4 gate passed.
