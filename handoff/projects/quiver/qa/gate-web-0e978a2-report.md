# Web gate 0e978a2 (on 75b03b2, 7e50760, ffcd32f) against backend 86f3fa5. Verdict: FAIL (not deployed)

Robin, 2026-10-28, about 15:45–15:55 Tehran time. Local stack: backend 86f3fa5 (mock mode, minimal env, throwaway SECRETS_MASTER_KEY, all real API keys blank), web 0e978a2 built in live mode with API base /v1 and dev login on, a same-origin proxy, and a mocked TLS RPC with a hosts entry. Everything has been torn down since. **QUALITY.md does not exist.** Evidence: web/shots/m5-1/m519w-*. Wren's summaries are in web/shots/final/.

## Results
- Build 0, tsc 0, npm audit 0. Lint: 0 errors, 1 warning (unused `_r`).
- **⌘K search (M5.17):**
  - Ctrl+K opens the palette and focus lands in the "Search" input.
  - I published a strategy named `Zqx <img onerror=…><script>…`. It shows up as escaped text: `window.__xss` stays undefined, and the dialog contains 0 img and 0 script elements.
  - Results are grouped under "Public strategies". ArrowDown moves aria-activedescendant from cmdk-0 to cmdk-3 with aria-selected following it. Tab stays trapped in the dialog. Escape closes it. Enter navigates.
  - A private strategy ("Zqp secretname") returns nothing from /v1/search. It appears only once, as the user's own local "Strategy" jump, which is fine.
  - The request is `/v1/search?q=…&limit=5`, debounced.
- **Data tag (M5.18), checked in a real browser:**
  - Running a backtest from /app/new shows `bt-datasource` = "Data: fallback" on desktop and at 390, which is correct with no key.
  - With the response's dataSource forced to "tiingo" through Playwright route interception, it shows "Data: Tiingo".
  - The market page (NVDA and WETH) shows "Data: fallback".
- **External copy:** /app/traders shows a calm "Coming soon — Copy any external wallet address…". No /copy request is ever sent. The `not_available` mapping reads "Coming soon. This isn't available yet." The API's 501 was confirmed on the VPS.
- **Using your RPC:** checked locally with a throwaway key and a mocked resolver. Loopback returns 422, the fake public host returns 200, data-rpc="user", the mock saw 4 calls, and nothing leaked into the DOM. Cross-origin, x-quiver-rpc is exposed (before 503/none, after 200/"user"). On the VPS only the fail-closed path was checked, because there is no vault key: `vault:"unavailable"`, and PUT returns 503 secrets_unavailable.
- Regression rerun of the ffcd32f flow at 0e978a2: /r and /c 404 and replay media OK, activity OK, no leaks or off-origin requests, wallet link on/off OK. axe on / and /leaderboard is now clean; the label-mismatch is fixed.

## Re-measured against Wren's claims
| Route | Lighthouse mobile (Wren / Robin) | LCP s | CLS | Desktop |
|---|---|---|---|---|
| landing | 95 / **95** | 2.26 | 0.002 | 100 |
| /app | 99 / **97** | 1.96 | 0 | 100 |
| /app/new | 98 / **95** | **2.56** | 0 | 100 |
| run page | 98 / **96–97** | 2.41 | 0 | 100 |

Accessibility, best-practices and SEO are 100 everywhere. **/app/new mobile LCP is 2.56 s, just over the claimed "<2.5 s".** That is within run-to-run noise, but the claim did not reproduce (Low). Overflow at 360 and 390 is **0 on all 13 routes** (confirmed).

The "clean axe" claim holds only for WCAG rules. axe best-practice reports `landmark-one-main` plus `region` (1–40 nodes) on all 12 signed-in app routes and /u at both widths, because the app shell has no `<main>` landmark.

## Findings (owner Wren)
| Sev | Finding |
|---|---|
| **Medium (blocking, explicit requirement)** | `/u/<unknown>` still returns **HTTP 200** (a soft 404; proxy.ts matcher covers only /r and /c). Unchanged since ffcd32f. |
| Low | The app shell lacks a `<main>` landmark: axe best-practice landmark-one-main and region on every /app/* and /u route. A skip link or `<main>` would fix it. |
| Low | /app/new mobile LCP 2.56 s versus the claimed <2.5 s. /app mobile is 97 versus the claimed 99. |
| Low | Lint warning: unused `_r` in lib/api/share-mock.ts:31. |
| Info | A11y: `li role=presentation` group headers sit inside the listbox. axe did not flag it. |

## Fix to unblock
Return a real 404 for unknown handles, either a server-side notFound() in /u/[handle] or the proxy matcher. Then re-gate; the rest looks deployable.
