# Gate: web b76c459 (Wren master, includes Ellis 1f38ea8 E1–E6) against backend 5637e10 (and e6303b3)
Robin, 2026-10-28 ~20:30 Tehran (UTC+3:30). **Verdict: PASS.**

## Provenance
- `git merge-base --is-ancestor 1f38ea8 b76c459` returns 0, so 1f38ea8 is an ancestor. Diff from 726e6a2: 47 files, lockfile identical.

## Ellis E1–E6
- **E1 OK.** PERF.md gives measured numbers only and states there is no steady 60 fps claim.
- **E2 OK.** The shimmer is a `[data-motion=shimmer]::after` sweep layer with `transform: translateX(50%)` keyframes, `will-change: transform` and `mix-blend-mode: darken`. There's no background-position animation.
- **E3 OK.** The `instruct-typed::after` caret is static in the ALWAYS section, and the blink lives only inside `prefers-reduced-motion: no-preference`.
- **E4 OK.** The `display` rules (`tick`, `.reads-sample`, the caret) sit in the ALWAYS section.
  - Info: the shimmer host's `position:relative; overflow:hidden` applies only when motion is allowed. It has no layout effect, since it's inline text with no overflow.
- **E5 OK.** Attribute MutationObservers are per hook element, with no subtree and their own `attributeFilter`. The only subtree observer is `document.body` childList, used to pick up added nodes.
- **E6 OK.** `web/motion/proof/` is gone from git. `.gitattributes` export-ignores proof/, *.mp4 and *.png. The `git archive` holds 0 proof files (10.9 MB → 2.2 MB).

## Other items
- **Warmup.** `warmupMsg()` branches on `warmupNotice.code === "warming_up"`, not on message text.
- **Revenue tag.** It reads "Paper ledger" when `accounting === "paper_ledger"` and "Accounting off" otherwise. Locally (flag off) it showed "Accounting off".
- **Links.** /terms, /docs and CopyDialog links are now always underlined (`underline decoration-accent/40`). axe link-in-text-block: 0.
- **LiveRun.**
  - `data-motion="tick"` moved from the `<td>` to an inner `<span>`, so the table cell is no longer inline-block.
  - The five conditional panels are now `next/dynamic` chunks.
  - F1: the status line has `max-sm:min-h-[2lh]`.
- **Lazy panels (parent's add-on).** I ran a layout-shift observer plus a 100 ms main-text sampler for 6 s on the run page, signed in:
  - CLS: 360px .0092, 390px .0105, 1440px .0248.
  - The main text never shrinks: 0 drops of 20% or more, so there's no hidden-content flash.
  - The largest source at 1440 is the absolutely positioned card stack (.0246). That's under .1 and not a lazy panel.

## Build and secrets
- `next build` OK, tsc 0, eslint 0. 0 files in `.next/static` mention INTERNAL_PROXY_TOKEN, OPS_TOKEN or OPENROUTER.
- Local build note: Turbopack refuses a node_modules symlink outside the project root, so I used a real `npm ci`.

## Lighthouse 12.8.2: mobile, signed in (dev login through a local Caddy-like /v1 proxy), 3-run medians
| route | perf | CLS | LCP ms | TBT ms |
|---|---|---|---|---|
| / | 99 | 0 | 892 | 102 |
| /app | 99 | .0018 | 707 | 116 |
| /app/new | 97 | .0902 | 741 | 102 |
| /app/run/:id | 99 | **.0179** (726e6a2: .140) | 754 | 116 |

- **F1 fixed.** Run page CLS went from .140 to .018.
- **Low:** /app/new CLS .090 is under the .1 "good" threshold but has the least headroom. Owner: Wren.

## axe (serious/critical) and horizontal overflow
- Pages: / /app /app/new run /terms /docs /app/revenue at 360, 390 and 1440, signed in.
- Result: 0 violations and 0 px overflow on all 21 checks.

## Stability
- No new kernel or OOM events in box dmesg during the gate. The last entry is the earlier 19:02 systemd-logind trace, which isn't mine.
- Port 4319 (Wren's process) was not running, and I touched no other agent's processes.

## Compatibility
- The web doesn't call deposit or swap, so the new backend fields (`recipientCode`, `insufficient_balance`) don't affect it.
