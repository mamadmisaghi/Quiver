# src/motion (Ellis)

All motion is opt-in via `data-motion` hooks; components never change for motion. Transform / opacity / clip-path only.

| file | what |
|---|---|
| motion.css | every CSS hook, in 3 tiers: ENTER (reduced-motion off, touch included), POINTER (hover + fine pointer only), REDUCED (nothing animates, static end states) |
| MotionHooks.tsx | mounted once in app/layout. Starts on idle. IntersectionObserver reveals (`reveal`, `read-row`) + WAAPI FLIP for attribute-driven hooks (`replay-cursor` x1, `trigger-hold` width, `trigger-state` data-state). No-op under reduced motion. |
| EdgeComets.tsx / FlightField.tsx | pointer-tier JS (comets + spring flight field), gated by `useFineMotion` |
| useMotionOK.ts | `useMotionOK` (reduced off) / `useFineMotion` (reduced off + hover + fine pointer) |

Rules: entrances start at opacity .001 (not 0) so Chrome still counts the paint for LCP; JS hidden states only exist under `html[data-mo]`, so no-JS shows the end state. Measured fps (real numbers, not a flat 60): see web/motion/PERF.md. Proof captures live outside the repo in /workspace/quiver/proof-archive/.
