# Gate: web 4eaca8b (on 968ca3a) vs backend 85377f4. Robin, 2026-10-28 16:25–16:40 Tehran

**Result: PASS** (0 Critical / 0 High / 0 Medium; 1 Low, Infos).

Setup: worktree /tmp/w4e at 4eaca8b. `npm ci`, `tsc --noEmit` OK, `eslint .` **0 errors / 0 warnings**, `next build` OK (0 warnings in the build log), `npm audit --omit=dev` 0. Live mode (NEXT_PUBLIC_API_MODE=live) against a local 85377f4 API. QUIVER_API_INTERNAL pointed at a logging relay, so every backend call made by proxy.ts was counted, and the relay could be switched to return 429/500 or hang.

## /u, /r, /c status (live mode)
| path | status | backend calls |
|---|---|---|
| /u/@nobody_here, /u/%40nobody_here | **404** (noindex) | 1 |
| /u/@demo_marco (demo), /u/%40trader_… (real, limited user) | 200 | 1 |
| /u/not%20a%20handle, /u/%E0%A4%A, /u/..%2f..%2fops%2fruns, /u/%252e%252e, /u/@a%3Fx=1, /u/@a%2f..%2fx, /u/@محمد | 404 | **0** (rejected by the Handle regex before any fetch) |
| /r/nope, /c/nope | 404 | 0 |
| /r/rpl_Z…, /c/crd_Z… (well-formed, unknown) | 404 | 1 |
| /c/<real card> | 200 | 2 (proxy check + page render; no loop) |
| /, /app | 200 | 0 |

## proxy.ts
- One fetch per request. The matcher covers only /u, /r and /c, and there is no retry loop. There is a 3 s AbortSignal timeout.
- Injection/SSRF: the handle is decoded at most 3 times, then must match `Handle`. Only then is it encodeURIComponent'd into a fixed `serverApiBase()` URL (env-only base). `../`, `%2f` and `?` never reach the backend (0 calls above). No SSRF.

## Fail open
- Relay returning 429 → 200 (20 ms); 500 → 200; hang → 200 after 3.0 s. Each is one call. The body has no stack, no internal host/port and no backend error text.
- **W1 Low (Wren + Sage):** the backend sees every proxy check from one IP (127.0.0.1). After 62 /u requests in a minute from any client, `/u/@nobody_here` returned **200** (soft 404) for everyone until the window reset. A direct API call from the same IP also got 429.
  - Impact: HTTP status/SEO only. The page still renders its not-found state client-side, nothing leaks, and nothing can be amplified (1 call per page, bounded by the limit). Acceptable for the preview.
  - Fix options: give the web server its own limiter key (loopback + shared header), cache the existence result in the proxy for about 30 s, or 404 on 429 for handles the backend recently 404'd.

## 968ca3a LOW fixes
- **Single `<main>`:** exactly 1 on /, /app, /app/new, /app/strategies, /app/markets, /app/traders, /app/activity, /app/settings, /u/@demo_lena, /u/@nobody_here and /c/nope, at 1440 and 390 px.
- **axe** (wcag2a/aa, wcag21aa, **best-practice**): 0 violations on all 22 page×viewport combinations. No horizontal overflow.
- **Lint:** 0 warnings.
- **/app/new LCP** (Lighthouse mobile, 3 runs, local `next start`):

  | run | LCP | perf | CLS | TBT |
  |---|---|---|---|---|
  | 1 | 2.55 s | 93 | 0 | 218 ms |
  | 2 | 2.11 s | 98 | 0 | 143 ms |
  | 3 | 2.11 s | 96 | 0 | 194 ms |

  **Median 2.11 s** (was 2.56 s). Fixed.
- `?idea=` prefill moved into Builder (window.location). The logic is unchanged and it is still never auto-submitted.

## 0e978a2 regression pass
- ⌘K: focus starts in the input. The hostile `<img onerror><script>` strategy name renders as text (`__xss` undefined, 0 img/script). Arrow-key activedescendant works, Tab is trapped, Esc closes, Enter navigates. The private "Zqp" strategy is not in the API search results; the palette shows it only as the user's own strategy.
- The API search response has no `q`.
- Data tag: market detail shows "Data: fallback" for both stock and crypto. The backtest shows "Data: fallback" with the next-open caveat.
- Traders page: external copy shows "Coming soon", and 0 /copy/wallet requests are made.

## Findings
| # | Sev | Owner | Finding |
|---|---|---|---|
| W1 | Low | Wren/Sage | The shared 60/min bucket means a burst of /u views turns unknown-handle 404 into a soft 200 for everyone, for up to 1 min. No leak or amplification. |
| W2 | Info | Wren | A /c real card makes 2 backend calls per view (proxy + page), as expected. |
