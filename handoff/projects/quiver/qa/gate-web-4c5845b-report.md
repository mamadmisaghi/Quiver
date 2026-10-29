# Gate: web 4c5845b (delta from 1b1a816) against backend 1e554b2/5a1120f, Robin, 2026-10-28

**Verdict: PASS with findings** (no blockers). Tested on a local stack (backend mock + next start, live API mode, dev login) at 1440 and 390 px. Shots are in quiver/web/shots/m5/4c-*.png. qa/QUALITY.md does not exist, so there was no checklist to apply.

## Static
lint 0, tsc 0, build 0. Diff 1b1a816..4c5845b: 26 files, +848/−35. package.json is unchanged.

## Delta checks
- **16aec80, signed-out /app/wallets:** shows "Sign in to link a wallet" (lw-signin) at both widths. PASS.
- **9c105c9 M5.5 profiles/follow/copy:** /u/@handle renders. Follow and unfollow toggle correctly. I visited /traders, /u, /app/settings, /leaderboard and /r as a second user and scanned the DOM and every /v1 response: **no `did:privy` anywhere**. axe found nothing serious. PASS. I did not exercise copy-to-paper or the detached state end to end; the code was reviewed only.
- **873a339 M5.6 chart image:** "chart-file" on /app/new. Over 2 MB → "That image is over 2 MB…". GIF → "Use a PNG, JPEG or WebP screenshot.". No overflow, console clean. I did not reach the server-side image_invalid path for a corrupt PNG through the UI; its copy map was reviewed.
- **6e0486e M5.7 /r/[token]:**
  - `<meta name="robots" content="noindex, nofollow">` is present, including in the revoked state.
  - The server strips U+202E from titles.
  - A route-mocked hostile title, handle and strategy name (`<img onerror>` + `<script>`) render as text only (__x=0, no injected img).
  - The HTML contains no usr_/run_/stg_ ids and no DID.
  - Revoke → 204, after which the page shows "This replay isn't available… owner revoked it."
  - **The HTTP status is 200, not 404** (see findings).
- **1630d28 M5.8 channels:** Telegram and X cards are present. An invalid X handle gives aria-invalid=true plus inline field error copy at both widths. PASS.
- **8e87004 M5.9 secrets:**
  - With the vault unavailable (the real backend state), the banner shows and both forms are disabled.
  - With a mocked vault "ok" and mocked PUTs:
    - after save, both inputs are empty and only hints show ("sk-or-…abcd", "https://rpc.secret-host-zz.example/…");
    - the test values were found in none of: DOM, localStorage, sessionStorage, URL or console.
  - PASS.
- **4c5845b PARITY.md:** rows 41 (chart), 55 (replay share), 66 (profiles: partial, no feed), 86 (alerts) and 87 (secrets) match the UI. Row 32 correctly calls Connect wallet a placeholder.
- **axe (serious/critical):** /r, /u, /app/settings and /app/wallets are clean. /app/new has scrollable-region-focusable (1 node) at both widths.

## Findings
| Sev | Owner | Finding |
|---|---|---|
| Medium | Wren | npm audit --omit=dev: 31 vulnerabilities (13 moderate, 18 high: ws, uuid, decode-uri-component), all transitive via @privy-io/react-auth (since 135a3f5). The 4ab4ad6 gate had 0. |
| Medium | Wren | Plan with AI (from 1b1a816) has no Cancel or Stop control, abort on unmount or timeout. A hung stream leaves "Planning…" disabled indefinitely. |
| Low | Wren | A revoked or unknown /r/[token] returns HTTP 200 with the "isn't available" copy (soft 404). It is noindexed, so the SEO impact is small, but the brief asked for a clean 404. Use notFound() or set the status. |
| Low | Wren | axe scrollable-region-focusable (serious, 1 node) on /app/new, and also on the run page and /app/autopilot at 390 (likely an overflow-x-auto table without tabIndex). |
| Low | Wren | Write-off confirm: autoFocus on "Yes, write it off" doesn't take effect. |
| Info | Wren | Lighthouse (1b1a816, same shell): mobile 94–98, desktop 100; a11y and best practices 100. |
