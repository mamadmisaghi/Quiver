# Doesn't-look-like-weft check (against /workspace/research/refs/weft-2026-10-21/NOTES.md)

| Area | weft.fi | Quiver | Verdict |
|---|---|---|---|
| Mark / motif | thread / weave, lines that converge | capsule quiver + 3 rising arrows; light-**arrows** with arrowheads on edges | different ✓ |
| Accent | signal blue #2b59ff / #7193ff + amber + green, all semantic | one brand accent, amber #FFB547 (hue 36°). No blue anywhere; the graph uses only amber | different ✓ (see caveat) |
| Robinhood green #00C805 (hue 121°) | — | not used. The only green is muted data-only `up` #8FD3A8 (sat 0.44, hue 142°), used for P&L numbers only | ✓ |
| Display type | Newsreader | Instrument Serif (narrower, higher contrast) | different ✓ |
| UI type | Instrument Sans | Geist + Geist Mono | different ✓ |
| Graph | Watches → When → Does, flowing curved edges | Signal → Trigger → Action, orthogonal edges with 12px rounded elbows, port dots, arrowheads, a dotted grid canvas | different ✓ |
| Easing | ease-out (.22,1,.36,1) | power2.inOut (.45,0,.55,1) | different ✓ |

**Overlaps to watch (be honest):** both are dark (#0A0A0B vs #0c0c0d), editorial serif with a plain-English prompt → node graph, and use a near-white pill CTA. weft's amber (#f0a83a) is close to ours, but weft uses it as one of three semantic colours. In Quiver it is the only accent. To keep the distance, Wren should not copy weft's centred narrow column, its 3-colour semantic graph, or its trust-diagram layout.

## v2 fixes (2026-10-27)
- The primary CTA is now an 8px-radius amber-hairline button with a nock notch and an arrow glyph. The cream pill is gone.
- Amber is accent-only. Status hues are live #8FD3A8, paper #B7ACE8, error #F2848F and idle grey, each at least 106° / 145° / 42° from #f0a83a (table in `tokens/CONTRAST.md`).
- The trigger node dot is now cream, and graph.css status dots use the status tokens.

## v3
- Mark is a literal quiver (body + fletched arrows), no thread/weave motif; no #2b59ff, no Robinhood green, no white pill (only button is the amber-outline "Open app" nock). Status pastels removed from marketing.
