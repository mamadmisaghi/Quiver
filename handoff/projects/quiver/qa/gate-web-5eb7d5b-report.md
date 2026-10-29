# Gate: web 5eb7d5b (after c37657c) + backend e0383b0 — Robin, 2026-10-28

**Verdict: PASS. Deployed. Web commit used: 5eb7d5b, which was still the head at deploy time.**

## Checks (fresh copy /tmp/robin-g5ebw)
- lint, tsc, build and npm audit 0 are all clean.
- The contracts match e0383b0 byte for byte except the intended lenient common.ts.
- Diff 3619bfe..5eb7d5b: 26 files, +357/−104.
  - It adds no new wallet, sign or `mode:"live"` code, and no dangerouslySetInnerHTML.
  - The new hrefs are internal `/app/run/…` links and `encodeURIComponent` idea links.

## Focus
- **"Seven things it reads":** the section renders with 7 "Start with this →" links to `/app/new?idea=…`, and the prefill matches the idea text.
  - A hostile `?idea=<img onerror>` renders as text: 0 injected elements. The idea is capped at 500 characters.
- **Triggers panel** (`data-testid=trigger-states`): shows each trigger with its wait state ("Missing a reading · fired 0 of 1 · Watching") from tick.triggers, with no console errors.
- **Link wrap at 360/390/768/1440:** 0 overflow, scrollWidth equals the viewport, and every idea link is a single 19 px line. Checked both locally and on :8091. Screenshot: shots/seven-360.png.

## Full flows (local against e0383b0)
Fake `window.ethereum` calls: 0 in every flow.
- **Approvals:** the 409 path shows "The run is paused. Resume it, then approve…" with a "Resume run" button, and the request stays pending. After resume, approve → approved + fill.
- **Partial close:** 50% → "Closed 50% … Simulated".
- **Alerts:** rule add works. The webhook is blocked locally by the fake DNS; it saved fine on the VPS with real DNS.
- **Portfolio:** shows server positions with asOf.
- **Replay on a ~5 min run:** 6 frames; Home, End, mid and Prev all work; chapters show.
- **Autopilot:**
  - the approvalMode toggle is there;
  - the kill confirm dialog appears and nothing is killed before confirming;
  - killed → ack + enable brings it back on;
  - the log shows strategy names.
- **Signing:** unchanged from 3619bfe. It is only user-initiated (SigningSteps, one click per step), and nothing in the UI can start live trading (goLive needs a confirm and a session key; the backend returns 403).
- **Lighthouse P/A/BP/SEO:** / 93/100/100/100, /app 99/100/100/100, /app/autopilot 98/100/100/100.

## Findings
- P3 (Wren): the page comment says `?idea=` is "Never auto-submitted", but Builder auto-runs compile on mount for a signed-in user. This was already true for `?q=` and the sample prompt.
  - Effect: opening any idea link immediately spends one LLM compile from the user's daily quota (10/day on the VPS).
  - It only creates a draft; nothing trades and nothing is signed.
  - Fix: don't auto-run when initialPrompt comes from `?idea=`, or correct the comment.
