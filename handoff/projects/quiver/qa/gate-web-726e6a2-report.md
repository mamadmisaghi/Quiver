# Gate: web master @ 726e6a2 (merge d5a67f2 of ellis/hooks-motion 7832a08) + backend 297d8dd. Verdict: **PASS**, deployed

Gate by Robin, 2026-10-28, 18:40–19:23 Tehran (UTC+3:30). The Ellis 7832a08 motion gate is folded in.

## Scope of the diff
- d5a67f2's tree is identical to 7832a08, so the merge introduced nothing extra.
- c9d669f..726e6a2 contains only:
  - the motion code: `src/motion/*` and `<MotionHooks/>` in layout, plus the proof media in `web/motion/proof`
  - 726e6a2's post-merge fixes:
    - Wren Low 1: `lib/contracts/config.ts` (the server env schema) removed from the web barrel, and `lenient-contracts.mjs` now deletes it on sync.
    - Wren Low 2: `whitespace-nowrap` on the Data chip and warmup note (market detail and backtest), and `WARMUP_SHORT` shortened to "warming up". The full sentence stays in `title` and sr-only.
    - LiveRun: the sub-line is split into flex spans (LCP).
    - An `instruct-typed` hook span in InstructPanel (markup only).
- motion.css and MotionHooks.tsx are byte-identical to 7832a08, so the branch motion results carry over. They were re-measured on master anyway.

## Build
- Local live-mode build (`NEXT_PUBLIC_API_MODE=live`): npm ci OK, next build OK with 0 warnings, tsc 0, eslint 0, npm audit (prod) 0.
- VPS build: compiled successfully, BUILD_ID `_fs77J8mHE4Kk7IeOUt9q`.
- `.next/static` contains **0** files with `INTERNAL_PROXY_TOKEN` or `OPS_TOKEN`, both locally and on the VPS.
- Bundle growth from the branch: JS +16 KB, CSS +0.7 KB gzipped.

## Lighthouse mobile, 3-run medians: main c9d669f → master
The harness ran the live-mode build with the mock API. The run page was **signed in** with the dev login (pre-seeded Chrome profile; `auth/exchange`, `runs` and `events` all returned 200).

| Page | Score | LCP (ms) | CLS | TBT (ms) |
|---|---|---|---|---|
| / | 95 → 95 | 2258 → 2611 | .0019 → .0019 | 214 → 136 |
| /app | 97 → 98 | 1955 → 1957 | 0 → 0 | 126 → 135 |
| /app/new | 95 → 98 | 2681 → 2108 | 0 → 0 | 131 → 142 |
| /app/run/demo (signed in) | 85 → 91 | 1875 → 1855 | .239 → .140 | 162 → 196 |

No regressions. Ellis's exact numbers didn't reproduce (e.g. "/ 94→94, run 90→91"), but the direction holds.

## Motion checks (all on master)
- **Animated properties:** across 8 routes × 3 widths plus the draft flow, `getAnimations()` keyframes contain only transform, opacity and clip-path.
  - Exception (by code review): the pre-existing `q-shimmer` animates background-position.
- **Reduced motion:** on 8 routes plus draft and ⌘K: 0 `getAnimations()`, 0 running CSS animations (including ::after), `data-mo` not set, and 0 `[data-motion]` elements below opacity .5. The claim holds.
- **CLS (PerformanceObserver, signed in, scroll included, median of 3):**
  - At 390: 0 on all 8 routes.
  - At 1440: master equals main everywhere: /app/new .021 vs .020, /app/run/demo .040 vs .041, all others ≤ .004.
  - The motion code adds no layout shift. Ellis's "CLS ≤ 0.0019" holds for unauthenticated pages only (see F1).
- **No-JS:** 5 routes have 0 readable elements below opacity .2 or clip-hidden.
- **Slow 3G with 4x CPU:** no visible `[data-motion]` stuck hidden after load. Screenshots: `qa/shots-726e6a2/`.
- **Focus and keyboard:** the Tab sequence over 3 pages is identical to main. Every focused element shows a ring and is visible; ⌘K opens a dialog with focus in the input, and Esc closes it.
- **Overflow:** 0 on all 27 routes (every /app/* page, the public pages, /u/@demo_lena, an unknown /u, and market detail) at 360, 390 and 1440, signed in.
- **axe (wcag2a and 2aa):** 0 violations except /privacy, `link-in-text-block` ×1 at 1440. That page isn't motion-related and wasn't touched.
- **fps, rAF over 5 s while scrolling, median of 3, master vs main:**

  | | / | /app | run | /leaderboard |
  |---|---|---|---|---|
  | Chromium 4x CPU | 58 vs 58 | 60 vs 60 | 60 vs 60 | 60 vs 60 |
  | Firefox | 56 vs 56 | 60 vs 60 | 60 vs 60 | 60 vs 60 |

  On / in Firefox, master had 3 frames over 50 ms, against 0 on main.
- **360 Data chip and warmup note:** the warmup notice was injected into the history response. Both sit on one line at 360 and 390, with chip height 23 px (main: 41 px, wrapped) and no overflow. Shots: `qa/shots-726e6a2/warmup-*`.
- **Taste:** on brief per `_taste.md`. One house ease, 6–12 px rises, scale .96–.98, no bounce; calm and nullmask-like.

## Findings (none blocking)
- **F1 (Low, owner LiveRun/web, pre-existing and improved):** on the signed-in mobile run page, Lighthouse CLS is .14 (main .24). The stats grid (`mt-8 grid grid-cols-2 …`) shifts when run data arrives. Fix: reserve its height.
- **E1 (Low, Ellis):** the "60 fps" claim is not exact. Home runs at 56–58 fps on both builds, and Ellis's own proof-results.json shows feed 54 fps with 2 long tasks.
- **E2 (Low, Ellis):** `q-shimmer` animates background-position, which breaks the transform/opacity/clip-path rule.
- **E3 (Info, Ellis):** the "every hook except the instruct caret" wording is off: the caret *is* animated. Also, the new `instruct-typed` hook has no CSS yet, so the planned ::after caret isn't wired.
- **E4 (Low, Ellis):** `tick` and `.reads-sample` get `display:inline-block` only when motion is allowed, so reduced-motion layout can differ slightly.
- **E5 (Low, Ellis, perf):** the MutationObserver watches every `style` attribute change across the whole body.
- **E6 (Low, Ellis):** about 3.3 MB of proof mp4 and png files are committed in `web/motion/proof/` and included in the deploy tarball. They aren't served, but should move out of the repo or be ignored.

## Deploy, 19:20 Tehran
Details and rollback are in `vps-deploy-log.md`.
