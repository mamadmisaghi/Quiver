# Hosted navigation repair gate — 2026-10-29

## Reproduction
Live origin: https://quiver-studio.gofivahootan.chatgpt.site
Clicking Open app on the hydrated landing page leaves the page in place and logs `TypeError: e is not a function` in `link-B0YZ_n0r.js` (2026-10-29T07:26:18Z).
The failing code destructures `navigateClientSide` from a dynamic navigation import; the production module uses renamed exports without that named export. Development does not reproduce this production-bundle failure. The original release's development-only browser gate missed it.
Direct document navigation to /app/new works. Draft strategy progresses and renders the nine-node demo, confirming the reported main failure is link navigation.

## Repair
Central application Link adapter calls the public useRouter push/replace methods directly. Replaced 32 next/link default imports. Real anchors remain for no-JS fallback, modifier/new-tab clicks, external links, downloads and same-page hashes. No node_modules patch, dependency upgrade, visual redesign or access change.

## Pre-publication checks
PASS: frontend TypeScript; production build (all 28 routes). The generated application Link bundle imports the public router directly and no longer uses the failing next/link dynamic import.
Release gate covers this scoped frontend repair only; existing backend failures and mock limitations are unchanged.

## Required post-publication regression before handoff
Use the actual production URL, not only the development preview: Open app, Skills section, Leaderboard, sidebar Markets/Skills/Strategies, and a local interactive control. Check for new application errors.
Rollback: prior version 1 (b8468fa51ca995c9ae2f8b57c00d6fd7ae03b0af), which preserves source but has the reported navigation defect.

## Production regression (version 2)
- Open app click now navigates from / to /app/new, with no new application error.
- Sidebar Skills navigates to /app/skills. The Stocks filter updates selected state and card contents.
- The logo navigates back to the landing page.
- Found a second independent defect: header Skills targets /#skills, which does not exist. Corrected it to /app/skills for both desktop and shared mobile menu.
- Leaderboard header link navigates to /leaderboard and renders the ranked table.
- How it works from /leaderboard navigates to /#how and renders/scolls to its section.
- No new application console errors in these post-fix flows (browser extension metadata warnings excluded).
