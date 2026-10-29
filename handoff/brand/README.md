# Quiver: style-lock + production kit (v2, 2026-10-27)

## v4
- Default mark is `MARK=v4` (v2 capsule + real archery arrows). `MARK=A|B|C` still builds the v3 options.
- Archives: _archive-v2/ (capsule v2), _archive-v3/ (quiver-body v3). qa/mark-v4.png = v2 vs v4.
- Rebuild everything: `templates/build_all.sh` (also renders qa/mark-v4.png).


## v3 build
- Everything: `templates/build_all.sh` (≈4 min; renders review kit + final/). `TICKER` (default $QUIVR) and `MARK` (A default) env vars.
- Canonical demo data: templates/demo.json. Tweet copy: templates/tweets.json.
- final/ = clean exports (hero still+mp4+webm+html, tweet-images, og, social banner/avatar) with no SAMPLE COPY / MOCK badges.
- v2 kit archived at _archive-v2/ for comparison. Mark options: qa/mark-options-v3.png. Small sizes: qa/small-size-test.png.


Everything here is rendered from code (hand-built SVG, plus HTML shot by Playwright on system Chrome). There are no AI images. The wordmark is Instrument Serif **outlined to paths** with HarfBuzz kerning, so the SVGs don't need any fonts.

**Rebuild:** `cd templates && TICKER='$QUIVR' python3 build.py && python3 tokens_build.py && python3 hero.py && python3 rec.py still && python3 rec.py video && python3 tweets.py && python3 sheets.py`
The ticker is one env var (default `$QUIVR`). It appears in the X banners, hero (still + video), tweet images, OG and the brand-sheet header.

## Palette
bg #0A0A0B · amber #FFB547 (accent only, never a status; pressed #E0952A) · status live #8FD3A8 / paper #B7ACE8 / error #F2848F / idle #8A867F · cream #EDE6DA (mark, wordmark, values) · text #F5F3EF · greys #B9B4AB / #8A867F · lines #26262B / #34343B. Contrast checks are in `tokens/CONTRAST.md`: all text pairs pass AA, and amberDim is decorative only.

## Paths
1. Mark (`mark/`), transparent, viewBox 120×64 (small: 64×64)
   - `quiver-mark.svg` (full colour), `quiver-mark-cream.svg` (mono), `quiver-mark-ink.svg` (for light backgrounds), `quiver-mark-bold.svg` (heavier weight, used for icon/token/avatar)
   - `quiver-mark-small.svg`, `quiver-mark-small-cream.svg`: 16px-safe glyph with 2 heavy arrows and no capsule
   - Every one also as `-2048.png` and `-4096.png`. `motion-ready/quiver-mark-layers.svg` has named layers (`capsule`, `arrow-1..3`)
2. Wordmark + lockups (`lockup/`): `quiver-wordmark(.svg|-cream)`, `quiver-lockup-horizontal(.svg|-cream|-ink-on-light)`, `quiver-lockup-stacked(…)`. Each as SVG plus PNG at 2048 and 4096 (longest side), transparent
3. App icon (`icon/`): `app-icon-1024.png` (full-bleed, for iOS/Android masks), `app-icon-rounded-1024.png` (transparent corners), SVGs
   - Favicons (`favicon/`): `favicon.ico` (16/32/48), `favicon-16/32/48.png`, `favicon.svg`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`
4. Token (`token/`): `token-logo-1000.png` and `.svg`. The mark sits at 82% width, inside the inscribed circle. Proof: `qa/token-48-circle*.png`
5. Social (`social/`): `x-avatar-400.png`, `x-avatar-1000.png`, `x-avatar-transparent-1000.png`, `avatar.svg`
   - Banners: `x-banner-1500x500.png`, `x-banner-3000x1000.png`. Safe-zone overlay: `qa/x-banner-safezones.png`
6. Tokens (`tokens/`): `tokens.css`, `tailwind.quiver.ts`, `tokens.json` (colours with roles, fonts, radii, spacing, shadows, motion, type, contrast results), `CONTRAST.md`
7. Type (`type/`): `type-specimen.png` (3200×2200), `type.css`
8. Hero (`hero/`): `hero.html` (runs live in a browser; `window.__seek(ms)` makes it deterministic), `hero-2880x1800.png`, `hero-loop-1920x1200-60fps.mp4` (H.264 CRF 14) and `.webm` (VP9). Each loop is 6 s and seamless.
9. OG (`og/`): `og-1200x630.png`, `og-1200x630@2x.png` (2400×1260)
10. Tweet images (`tweet-images/`): `tweet-01-announcement-3200x1800.png`, `tweet-02-strategy-card-3200x1800.png`, `tweet-03-stat-3200x1800.png`. The template system is `templates/tweets.py`, with copy in `templates/tweets.json`. Every image carries a SAMPLE COPY tag; add an entry with layout `announce` | `feature` | `stat` to make more.
- Guide: `BRAND.md` (logo, clear space, minimum sizes, colour, type, buttons, motion, voice, weft-distance rules)
- QA (`qa/`): `small-size-test.png`, `token-48-circle(-zoom4x).png`, `favicon-16-on-white-zoom8x.png`, `x-banner-safezones.png`, `WEFT-CHECK.md`
- Overview: `brand-sheet.png` (2400×2150)
- Source (`templates/`): `geo.py` (mark geometry and text outlining), `build.py`, `graph.js`/`graph.css` (the live-graph component, reusable by Wren/Ellis), `hero.py`, `rec.py`, `sheets.py`, `tokens_build.py`, `shoot.py`

## Usage rules
- Clear space = capsule height ÷ 2 on every side. The minimum full mark is 24px wide. Below that, use `quiver-mark-small`.
- Only one arrow is ever amber, and it is the first (leftmost) one. Don't recolour the capsule, add glow, or rotate the mark.
- On light backgrounds use the `-ink` variants. The cream and full-colour files are for dark backgrounds.
