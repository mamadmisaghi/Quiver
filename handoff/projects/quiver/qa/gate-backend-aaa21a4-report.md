# Gate: backend aaa21a4 (M4.7 d6f5cec + M4.8 8c3ad0c + M4.9 aaa21a4, on top of e0383b0) — **PASS**

Gated 28 Oct 2026, around 10:30–11:00 Tehran time (UTC+3:30). Fresh git-archive copy: /tmp/robin-gaaa.

## Standard checks
- vitest 363/363 (41 files); with the probe, 370/370 (42 files)
- tsc OK, lint OK, fixtures:check OK (38 files), npm audit 0, forge 54/54

## Probe: `qa/poc/robin-gaaa-m47-49.test.ts` (7/7 pass)
The OpenRouter path was tested end to end by stubbing `fetch` to openrouter.ai with `OPENROUTER_API_KEY` set.

### M4.9 instruct
- **Malicious model output**
  - The probe sent five bad outputs: `set_mode live`, an op with an extra `note` key, an unknown actionId, free text around the JSON, and an extra `system` key.
  - Every one fell back to the demo parser (`compiler:"demo"`), and none of the injected content reached the ops. The run stayed in paper mode.
  - The prompt sends only `{strategy outline, instruction}` as JSON; the strategy name is not included. The request uses `json_schema` with `strict:true`.
- **Malicious user text** goes only into the JSON `instruction` field, and the ops list is closed. Nothing can change the mode or the venue.
- **No loosening of risk caps.** Apply uses the same `validateStrategy` as create, and every probe case gave the same verdict on both paths:
  - `maxPositionPct` 500 → rejected (create max is 100);
  - `maxTotalExposurePct` 101 → rejected;
  - `pct_equity` 400 → rejected;
  - a USD size of 1e9 → accepted, but create accepts it too (runtime % caps still apply).
  - Leverage is capped at 10 by the schema on both paths.
- **Apply races**
  - Concurrent double apply: one 200, one 409.
  - A superseded proposal: 409.
  - Expired (after 15 min): 409 `expired`.
  - Another user proposing or applying: 404.
  - Apply and stop sent concurrently: both returned 200, with the apply landing first. The run ends `stopped` and nothing keeps running. A new instruct afterwards gets 409.
- **Paper only.** Live and testnet runs are refused (`mode_not_enabled`).
- **LLM spend**
  - With a $1 cap and $0.40 per call, the AI was called 3 times, then fell back to demo.
  - **Finding B1 (low):** the budget is checked before each call, so the last call can overshoot the cap by up to one call's cost ($1.20 spent against $1).
  - **Finding B2 (low):** instruct does not count toward `LLM_USER_DAILY_COMPILES`. With a compile cap of 2, 6 instructs left `compilesUsedToday:0`. The only per-user limit is instruct's own 100 per day, so one user can use up the global daily budget for everyone. On the preview, dev login lets anyone create users anyway.

### M4.8 cards and leaderboard
- **Card token**
  - Format is `crd_` plus `randomBytes(24)` in base64url (crypto CSPRNG, 192 bits).
  - Re-sharing issues a new token.
  - A malformed or unknown token returns the same 404.
  - Another user's share or revoke returns 404.
- **Card JSON** contains percentages, counts, venues, the strategy name, startedAt/stoppedAt and a handle. It has no run, user or strategy ids, no USD amounts, no wallet and no email.
- **Revoke** makes the API return 404 immediately. The API sends `cache-control: public, max-age=30`, so a shared cache could keep serving the card for up to 30 s. The web /c page fetches with `no-store` and is served `private, no-store`, and Caddy doesn't cache.
- **Rate limits:** the card endpoint returns 429 after 60 requests per minute per IP, and the leaderboard after 30 (existing test).
- **Opt-in:** a user's paper run on an unpublished strategy never appears on the leaderboard, even with min trades set to 0. Only explicitly published strategies are listed.
- **Finding B3 (low, privacy):**
  - Email-like and phone-like labels become `@trader_<sha256(label)[:8]>`. The hash is unsalted, so anyone who already knows an email can confirm it.
  - Labels that look like real names (e.g. `@john.doe`) are shown as they are.
  - Suggest an HMAC with a server secret.

### M4.7
- `GET /runs/:id`, `POST /stream-tickets` and `GET /runs/:id/events` all return 404 for another user. The triggers snapshot and `triggerStates` are only reachable through these owner-checked routes.

## Regression
The g5d5, g8e9 and ge03 PoCs give the same results as on e0383b0: the same 9 FINDING assertions still flip (they are fixed), and there are 0 new failures.

## Verdict
**PASS.** B1–B3 are low priority (Sage).
