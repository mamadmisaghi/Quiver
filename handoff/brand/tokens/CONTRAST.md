# Contrast checks (WCAG 2.x)

| fg | bg | ratio | AA text | AA large |
|---|---|---|---|---|
| text #F5F3EF | bg #0A0A0B | 17.86 | ✓ | ✓ |
| text2 #B9B4AB | bg #0A0A0B | 9.59 | ✓ | ✓ |
| text3 #8A867F | bg #0A0A0B | 5.46 | ✓ | ✓ |
| cream #EDE6DA | bg #0A0A0B | 15.96 | ✓ | ✓ |
| amber #FFB547 | bg #0A0A0B | 11.26 | ✓ | ✓ |
| text3 #8A867F | bg2 #17171A | 4.94 | ✓ | ✓ |
| text2 #B9B4AB | bg2 #17171A | 8.67 | ✓ | ✓ |
| bg #0A0A0B | amber #FFB547 | 11.26 | ✓ | ✓ |
| bg #0A0A0B | cream #EDE6DA | 15.96 | ✓ | ✓ |
| up #8FD3A8 | bg #0A0A0B | 11.36 | ✓ | ✓ |
| down #F2848F | bg #0A0A0B | 7.98 | ✓ | ✓ |
| amberDim #7A5A2B | bg #0A0A0B | 3.13 | ✗ | ✓ |
| statusLive #8FD3A8 | bg #0A0A0B | 11.36 | ✓ | ✓ |
| statusPaper #B7ACE8 | bg #0A0A0B | 9.5 | ✓ | ✓ |
| statusError #F2848F | bg #0A0A0B | 7.98 | ✓ | ✓ |
| statusIdle #8A867F | bg #0A0A0B | 5.46 | ✓ | ✓ |
| amber #FFB547 | bg1 #111113 | 10.74 | ✓ | ✓ |

## Status hues vs weft amber #f0a83a (hue 36°)
Amber #FFB547 is accent-only (CTA, light-arrows, one highlight per view) and never means a status.

| status | hex | hue | Δhue from #f0a83a |
|---|---|---|---|
| statusLive | #8FD3A8 | 142° | 106° |
| statusPaper | #B7ACE8 | 251° | 145° |
| statusError | #F2848F | 354° | 42° |
| statusIdle | #8A867F | 38° | 2° (neutral grey) |

amberDim is decorative only (inactive edges), never for text.
