# Quiver: brand guide (style lock v2, 2026-10-27)

## v4 mark (user decision, Oct 27 2026) — supersedes the v3 mark section below
- **Mark = v2 capsule, kept exactly** (120×64 artboard, rect inset 2.3, stroke 4.6, rx 29.7, cream #EDE6DA; ink on light #0A0A0B). Arrow positions/angle (45°) are the v2 ones; only the arrows changed: three real archery arrows (barbed pointed head, thin shaft, three swept fletching feathers per side at the tail). Left arrow amber #FFB547 (ink: #C9821C), as in v2.
- **Simplified (≤48px): same capsule with the v2 small-size stroke (7.5)** and 2 heavier real arrows (amber left, two feathers per side). Used by favicon (on #17171A tile), token, avatar, small lockups, tweet/hero headers.
- Full mark ≥64px tall-equivalent use; at 16px only the capsule + colour reads (as with v2).
- Built by `templates/qmark.py` → `v4_svg()`; `MARK=v4` is the default. v3 options A/B/C remain (`MARK=A|B|C`) but are unused. Comparison: qa/mark-v4.png. v3 kit archived in _archive-v3/.


## v3 changes (Critiquito pass) — supersedes anything below that conflicts
- **Mark: Option A "Fletch fan".** Three fletched arrows stored fletching-out, fanned from one pivot inside an open, leaning (14°) quiver body with rim and strap. Centre arrow amber = the one strategy you pick. Rejected B (broadheads read as growth arrows) and C (up-right amber head = finance cliché, busy <48px). See qa/mark-options-v3.png. Geometry: templates/qmark.py (`MARK=A|B|C` env var switches the build).
- **Size rule:** full mark only at **64px and up**. At **48px and under** (token, avatar, favicon, small lockup) use the simplified mark (2 thick arrows, solid body): mark/quiver-mark-small{,-cream,-ink}. Favicon always sits on its #17171A rounded tile so it reads on light and dark tab bars (qa/small-size-test.png).
- **Clear space:** = width of the amber arrow's fletching × 2 on all sides. Min sizes: full 64px, simplified 16px.
- **One demo strategy:** templates/demo.json (`// MOCK`) — hood-dip-buyer, $500 of HOOD, RSI<30, TP +8%, 90d backtest +12.4% / −4.1% / 38 trades / 61%. Hero, banner, tweets and OG all read it. Never quote these numbers as real.
- **Venues:** lead with Robinhood Chain only. Others appear only on a small "connects to …" line (hero footer); cut from banner, tweets, OG.
- **Marketing images:** no status pastels (green/red/lilac) — neutral node dots, amber is the only accent. Status hues are product-UI only.
- **Tweet mono labels ≥16–18px at 1600w**; disclaimers ≥18px directly under any number.
- **Hero header:** ticker is a plain mono text link; "Open app" is the only button.
- **Review vs FINAL:** default build keeps SAMPLE COPY / // MOCK badges; `FINAL=1` writes clean files to final/. Disclaimers stay in both.


**Positioning:** Quiver is an AI strategy builder for Robinhood Chain. You type a trading idea in plain English, and it becomes a live graph of signals, triggers and actions that you paper trade, backtest and then run. It also works on Solana, Hyperliquid and Polymarket, with tokenized stocks as a minor venue.
**Tagline:** Every strategy is an arrow. **Ticker:** `$QUIVR` (one variable, `TICKER`, in `templates/`).

## Logo
- **Mark:** a capsule quiver holding 3 rising arrows. Only the first (leftmost) arrow is amber. Files are in `mark/`.
- **Variants:**
  - full colour (dark backgrounds)
  - cream mono (dark backgrounds, single-colour)
  - ink (light backgrounds)
  - bold (icon, token, avatar)
  - small: 2 heavy arrows with no capsule, for 24px and below
- **Lockups:** horizontal (the default) and stacked, in `lockup/`. The wordmark is outlined Instrument Serif. Never retype it.
- **Clear space:** half the capsule height (0.5 × mark height) on every side. In lockups, the gap between mark and wordmark is fixed by the files.
- **Minimum sizes:**
  - full mark: 24px wide on screen, 12mm in print
  - horizontal lockup: 96px wide
  - stacked lockup: 64px wide
  - below 24px, use `quiver-mark-small`
  - favicons use the small glyph at 16/32/48
- **Don't:**
  - recolour the capsule
  - make more than one arrow amber
  - add glow, gradients or bevels
  - rotate or skew the mark
  - put the colour mark on a light background (use ink)
  - redraw the arrows at a different angle
  - put the mark in a circle badge with a letter

## Colour (`tokens/tokens.json`, checks in `CONTRAST.md`)
| Role | Hex |
|---|---|
| bg / raised / card | #0A0A0B / #111113 / #17171A |
| hairline / strong line | #26262B / #34343B |
| text / secondary / tertiary | #F5F3EF / #B9B4AB / #8A867F |
| cream (mark, wordmark, values) | #EDE6DA |
| **amber accent** / pressed | **#FFB547** / #E0952A |
| data up / down | #8FD3A8 / #F2848F |
| status live / paper / error / idle | #8FD3A8 / #B7ACE8 / #F2848F / #8A867F |

**Amber is accent-only.** Use it for the primary CTA, the light-arrows on graph edges, one highlight per view, and the first arrow of the mark. It never encodes a status, and no status hue may sit within 40° of #f0a83a (see `CONTRAST.md`). Tertiary text must be at least 12px.

## Type (`type/type.css`)
- **Instrument Serif:** display and headings. Use tight tracking (−1.5 to −2.5%), and at most one *italic* word per heading, in cream.
- **Geist:** UI and body.
- **Geist Mono:** labels (uppercase, +8–12%), tickers and every number (tabular figures).
- Use real quotes and dashes (“ ” — −) and the × sign.

## Buttons
- **Primary:** 38px tall, 8px radius (squared, **not a pill**). Amber text on a 7% amber fill, with a 1px amber hairline at 55%. It has a **nock notch** cut into the left edge and an up-right arrow glyph after the label.
  - Hover: 12% fill, full-amber line.
  - Pressed: #E0952A text.
- **Secondary:** same shape, #34343B hairline, text colour, Geist Mono for tickers.
- **Never:** a near-white or cream full pill.

## Motion
- One house ease, power2.inOut `cubic-bezier(.45,0,.55,1)`.
- Durations: 160 / 280ms for UI, and 1.2–1.4s for a light-arrow to travel one edge.
- **Light-arrows:**
  - an amber head with a 3-step fading tail moves along orthogonal edges
  - when it lands, the target port pings and the node border warms to amber for about 700ms
  - only 1–2 arrows are in flight at once
  - loops are 6s and seamless
- **Micro-motion:** node values drift by ±1–2 units, carets blink at 530ms, status dots breathe. No bloom, no particles behind text, no parallax tricks.
- Respect `prefers-reduced-motion`: show the static graph with one arrow parked mid-edge.

## Voice
- **Do:** be short, specific and mechanism-first ("Plain English in, live graph out."). Use numbers with sources, and mark demo data `// MOCK`.
- **Don't:** use "to the moon", "revolutionary", "next 100x", emoji strings, or invented performance figures.

## Distance from weft.fi (hard rules)
1. No thread, weave or converging-lines motif. Our motif is arrows with heads, on orthogonal edges with 12px elbows, port dots and a dotted grid.
2. No blue anywhere (#2b59ff, #7193ff or near them), and no Robinhood green #00C805. The only green is the muted data/live #8FD3A8.
3. The graph is single-accent: nodes are neutral and only the travelling arrows are amber. Don't use a 3-colour semantic graph (blue / amber / green).
4. Node vocabulary is Signal → Trigger → Action, never Watches / When / Does.
5. Type stays Instrument Serif + Geist + Geist Mono. No Newsreader and no Instrument Sans.
6. Primary CTA is the amber nock button. No white or cream pill.
7. Layout: an asymmetric two-column hero with the product panel on the right. No narrow centred column and no can/can't trust diagram layout.
8. The house ease is power2.inOut, not weft's ease-out (.22,1,.36,1).
