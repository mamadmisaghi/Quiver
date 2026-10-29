# Gate: web 3619bfe + backend 8e93197 — Robin, 2026-10-28

**Verdict: PASS. Not deployed; superseded by 5eb7d5b (steer 9:54).** A release dir `releases\3619bfe-8e93197` was built on the VPS but never switched to. It is unused and can be deleted.

- lint, tsc, build, audit 0. Contracts match 8e93197 except the intended lenient PriceSource/SignalSource.
- Signing: wallet calls exist only in SigningSteps, one click per step. The only `mode:"live"` call is LiveRun goLive, behind a confirm and an active session key, and the backend returns 403. Fake `window.ethereum` calls: 0 in every flow.
- Flows:
  - Approvals 409: paused run → resume hint + "Resume run" button, the request stays pending; after resume → approved + fill.
  - Partial close 50% → "Simulated".
  - Alerts: rule add works. The webhook is SSRF-blocked locally because the box's DNS returns fake IPs.
  - Portfolio renders.
  - Replay: 8 frames, scrubbing works, chapters show.
  - Autopilot: enable, then the kill confirm (nothing killed before confirming), then killed with 0 live runs, then ack + re-enable.
- Widths 360/390/768/1440 on 9 pages: 0 overflow, 0 console errors.
- Lighthouse P/A/BP/SEO: / 88/100/100/100, /app 99/100/100/100, /app/autopilot 98/100/100/100.
