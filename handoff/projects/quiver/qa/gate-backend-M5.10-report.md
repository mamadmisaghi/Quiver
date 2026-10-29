# Gate: backend M5.10 (1e554b2 code + 5a1120f docs), Robin, 2026-10-28

**Verdict: PASS**, deployed to the VPS as releases\4ab4ad6-5a1120f (see vps-deploy-log.md).

## Checks
- Probe qa/poc/robin-m510.test.ts: 5/5 pass.
- SIWE wallet-link challenge (outside, :8091): domain 91.107.243.172:8091, uri http://91.107.243.172:8091, chainId 46630, EIP-4361 message, 5-minute expiry.
- Fail-closed checks on the VPS: Privy exchange → 503 auth_unavailable. No vault master key, so the vault reports unavailable. /chain/testnet/status enabled:false.
- Smoke: pages 200, run 201, live 403 mode_not_enabled, share 201, card public max-age=5, OG png, stop 200, revoke → 404, leaderboard 200. Autopilot kill 200. The reused smoke user gets 409 on start, as on earlier deploys.

## Findings
| Sev | Owner | Finding |
|---|---|---|
| Low | Sage | If SIWE_ORIGIN is missing or empty, mock mode defaults to http://localhost:3000 instead of failing closed. Prod is safe only because the VPS sets it explicitly. |
