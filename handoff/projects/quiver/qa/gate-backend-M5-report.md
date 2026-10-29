# Backend gate — M5.1–M5.9 (Robin), 2026-10-28

**Verdict: PASS for M5.1–M5.9, with Medium and Low findings (none block the :8091 paper preview).**

Deploys:
- 90f1c68 (M5.1–6) deployed first as release `4ab4ad6-90f1c68`. The M5.7–9 scope extension arrived after this deploy had already run; M5.1–6 had passed under the original scope.
- 7bb0157 (M5.1–9) is now live as release `4ab4ad6-7bb0157`. Web is unchanged at 4ab4ad6.

## Checks
- 90f1c68: vitest 417/417, tsc/audit/lint/fixtures 0, forge 54/54.
- 7bb0157: vitest 435/435 (56 files), tsc/audit/lint/fixtures 0, forge 54/54.
- Probes: qa/poc/robin-m5.test.ts (+ .out.txt) and qa/poc/robin-m579.test.ts (+ robin-m579.out.txt).

## M5.1–6 findings
- **Medium (Sage):** Privy handle leak. A Privy user's handle shows as `@privy:did:privy:…` in /profiles and in public strategies `author.handle`, while /traders uses the HMAC alias. Fix this before Privy is enabled.
- **Medium (Sage):** after unfollowing, copy sync still works (200, version 2) and the copy run keeps running.
- Low (Sage): one wallet address can be linked to several accounts. The link message is not SIWE (no domain or chainId).
- Low (Sage): copy loop. A user can copy a re-published copy of their own strategy.
- Low (Sage): a user with no public strategies still has a profile that exposes displayName, bio and following count.
- Low (Sage): the image check accepts polyglot files, a data-URL prefix that doesn't match the declared type, and 4096² bomb-like files; the server never decodes pixels. Rate limit and quota count rejected requests and compiles together.
- Low: write-off loss is capped at the margin.
- Info: high-s (malleated) signatures are accepted for JWTs and wallet links (harmless: nonces are single-use). Unknown-kid JWKS refetch is bounded only by the auth rate limit.
- Everything else held: JWT alg/iss/aud/exp/kid matrix → 401, JWKS down → 503, write-off IDOR/stale/double confirm, copy IDOR/caps/mode, plan-stream lock and rate limit, no image bytes stored.

## M5.7–9
**M5.7 replay: PASS.**
- The public replay has no runId, userId, strategyId or wallet. The handle is publicHandle (the alias for Privy users).
- The snapshot stays frozen. IDOR on share, revoke and render → 404. Revoke → public 404, render after revoke → 409.
- Low (Sage/web): the title is stored raw (`<script>`, U+202E), so the UI must escape it.
- Info: the replay stays public after the run is stopped (by design).

**M5.8 channels: PASS.**
- Telegram and X report status "stub" even with tokens set. Deliveries end as not_configured. There were 0 outbound fetches and no tokens in the audit.
- Low: an X target can be any handle (spam risk once it is wired).

**M5.9 vault + SSRF: PASS.**
- No plaintext in the list, snapshot, audit, /me, or errors. /me/export doesn't exist (404). IDOR delete → 404.
- 2000 seals gave 2000 unique IVs. A wrong AAD, wrong key or truncated tag → null.
- The key comes from env; a bad or missing key → 503 secrets_unavailable.
- SSRF matrix: everything blocked except a public https host on an allowed port (the full matrix is in the probe output).
- Moved-row case: I first saw a 500, but that was my probe's artifact (an invalid id). Re-run with a valid id: 200, and the row shows `status:"undecryptable"`. The AAD binding works and there's no finding.
- Low: setAuthTag has no authTagLength set; pin it to 16.
- Info: stored RPC URLs aren't fetched yet. Whatever uses them later must re-run the SSRF and DNS checks at fetch time.
- Compat note: contracts widened the enums (AlertProviderName gains x, providerStatus gains stub). Web 4ab4ad6 is unaffected while ALERTS_PROVIDER is webhook.

## VPS (7bb0157)
- Graceful stop: 0 active runs, STOP_RC=0. The new API is PID 9876 on 8987; web PID 28332 and Caddy PID 12732 are unchanged.
- smoke OK.
- Privy: privy.enabled false (devLogin true, as before).
- `GET /me/secrets` → vault:"unavailable", so the vault fails closed (SECRETS_MASTER_KEY is not set).
- No running runs, ops list `items:[]`, pumpals.fun 200.
