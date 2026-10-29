# Quiver VPS preview deploy log — 2026-10-27 (Asia/Tehran) — **STOPPED BEFORE ANY CHANGE**
Only read-only commands were run over WinRM (cmd), reusing the PumPals method. Nothing was uploaded, installed, opened or reloaded. Caddy, PumPals, Obscura and GMGN are untouched. pumpals.fun returned 200 over valid HTTPS at the time of recon.

## Blocker: the hard limits contradict the verification steps
- Backend 19e4ba1 `/auth/exchange` accepts only `dev:` tokens, and only when `DEV_LOGIN_ENABLED=true`. Privy verification "is not configured in this environment". The web code also says Privy is not wired yet.
- Every `/v1` route except `/status`, `/compile` and `/auth/*` requires auth. That includes `/markets`, `/backtests`, `/runs`, `/stream-tickets` and SSE.
- So with dev login OFF, as the hard limit requires, nobody can sign in. /app/markets cannot show live prices, and the paper-run SSE and backtest checks are impossible. The preview would be the landing page plus "Sign in" buttons that fail.
- In addition, main.ts refuses dev login when `NODE_ENV=production`, so the plan's env (DEV_LOGIN_ENABLED=true + NODE_ENV=production) would not have worked either.
- Options for the user to choose from:
  - (A) Allow `DEV_LOGIN_ENABLED=true` behind Caddy basic auth only, with `NODE_ENV` not set to production. This was the original plan. The risk is that anyone holding the basic-auth credentials can sign in as any `dev:<label>`. Mock/paper only, no funds.
  - (B) Sage wires real Privy token verification and Wren wires the Privy client, then deploy with dev login off.
  - (C) Deploy as-is: landing page only, app screens non-functional.

## Recon findings (for whichever option is chosen)
- **Listening:**
  - Caddy (pid 12732, SYSTEM): 80, 443, 2096, 8080, 8880 (GMGN alt ports), with admin on 127.0.0.1:2019.
  - 127.0.0.1:8090 PumPals, 127.0.0.1:8787 **Obscura relayer**, 127.0.0.1:8791 GMGN panel.
- **Plan port conflict:** the plan's api port 8787 is taken by Obscura. Use api 127.0.0.1:8987 and web 127.0.0.1:4517, which are both free.
- **Public port candidate:** 8091. Nothing is listening on it and no inbound firewall rule covers it.
  - It would need a new rule: `netsh advfirewall firewall add rule name="Quiver preview 8091" dir=in action=allow protocol=TCP localport=8091`.
  - The site would be plain HTTP on the bare IP, same as the GMGN alt ports, so basic auth travels in cleartext. That is acceptable only for a short-lived preview.
- **Caddy:** the main Caddyfile is `import sites/*.caddy` with `admin localhost:2019`. sites\ holds obscura.caddy (which has an `http://:80` catch-all), pumpals.caddy and trader.caddy. A new sites\quiver.caddy with an `http://:8091` block would not collide with any of them.
- **Runtime:** Node is C:\sites\node\current (v24.22.0). Neither Node nor NSSM is on PATH, so use Scheduled Tasks (SYSTEM, boot trigger, restart 999×1min), like PumPals.
- **Informational:** a firewall rule named "SQL" allows inbound 2019. Caddy admin is bound to localhost, so it is not exposed, but the rule is odd and worth removing later (not touched).

---

## 2026-10-27 ~18:00–18:35 Asia/Tehran: Public preview deploy (web dd9d25f + backend 19e4ba1). Robin

**URL:** http://91.107.243.172:8091 (no basic auth, dev login ON, as the user chose).
**Status:** UP. Backend and proxy are healthy. **P1: browser dev sign-in fails on plain-HTTP origin** (see below).

### Changes on the VPS
1. `C:\sites\quiver\` (new): `releases\dd9d25f-19e4ba1\{web,backend}` (source from `git archive`, `npm ci` + `next build` done on the VPS), `logs\{api,web}.log`, `data\state.json` (dev persistence), `env\jwt.secret` (random 48B generated on the VPS, ACL SYSTEM+Administrators, never printed), `backups\caddy-20261027-pre-quiver\` (robocopy of C:\sites\caddy minus data), `up\` (upload staging), `bind.mjs`, `api-start.bat`, `web-start.bat`.
   - `bind.mjs` is a preload (NODE_OPTIONS=--import) that forces the API listener to 127.0.0.1, because 19e4ba1 has no HOST option and would otherwise bind 0.0.0.0. Verified with netstat: `127.0.0.1:8987`.
   - API env: QUIVR_MODE=mock, HL_NETWORK=testnet, PRICE_SOURCE=mainnet-readonly, DEV_LOGIN_ENABLED=true, NODE_ENV=development, TRUST_PROXY=true, CORS_ORIGINS=http://91.107.243.172:8091, **OPENROUTER_API_KEY unset**, TIINGO_API_KEY unset, LLM_DAILY_BUDGET_USD=1, LLM_USER_DAILY_COMPILES=10.
   - Web: `.env.production.local` holds NEXT_PUBLIC_API_MODE=live, NEXT_PUBLIC_API_BASE=/v1, NEXT_PUBLIC_DEV_LOGIN=1. It runs `next start -p 4517 -H 127.0.0.1`.
2. Scheduled tasks `\QuiverApi` and `\QuiverWeb` were cloned from the \PumPals XML: SYSTEM, BootTrigger PT30S, RestartOnFailure 999×PT1M, no time limit. They run `C:\sites\quiver\{api,web}-start.bat`.
3. `C:\sites\caddy\sites\quiver.caddy` (new): `http://:8091`. `/v1*` goes to 127.0.0.1:8987 and everything else to 127.0.0.1:4517. Both proxies have `flush_interval -1`, `header_up X-Real-IP {remote_host}` and `header_up X-Forwarded-For {remote_host}`. `caddy validate` passed, then `caddy reload`. The Caddy PID was 12732 before and after, so it was not restarted.
4. Firewall: `Quiver preview 8091` (in, TCP 8091, allow). This is the only rule added.
Nothing else was touched: not PumPals, Obscura, trader, the main Caddyfile, or the SQL 2019 rule.

### Verification (from outside)
- pumpals.fun: 200 with TLS verify 0 before and after.
- `/`, `/app`, `/app/markets` and `/v1/status` all return 200. /v1/status is ok:true, mode mock, all venues up.
- External connections to :8987 and :4517 time out (blocked). netstat shows both listening on 127.0.0.1 only.
- Prices come over the API through the proxy: NVDA 217.85, AAPL 346.83, TSLA 402.79, SPY 769.61, WETH 2325.49 (chainlink_mainnet_readonly).
- Dev sign-in works over the API (`/auth/exchange` with a dev: token returns a token). **It fails in the browser.** `crypto.randomUUID` is undefined on a non-secure (http IP) origin, so `devIdToken()` throws and the UI shows "Couldn't sign in". Signed-out users see "Sign in to load your data" on /app and /app/markets, so live prices are not visible in the UI.
- Compile is the deterministic Demo compile: costUsd 0, attempts 0, no paid call. A backtest of 7d to now−1h finished with status done. A 422 for `to` in the future is expected behaviour.
- SSE paper run through the proxy: 200 text/event-stream, with status+tick at 0.2s and ticks at 14.8s and 29.8s (no buffering). The run was stopped afterwards.
- Spoofed X-Forwarded-For/X-Real-IP is overwritten. On one keep-alive connection, 25 exchanges each carrying a different fake IP gave 20×200 then 429. Note that the box's egress IP rotates per connection, so tests over separate connections do not hit the limit.
- Secure refresh cookie: it is not stored on http, so a session does not survive a reload except through re-exchange.

### Spend
No paid API is reachable: OPENROUTER_API_KEY and TIINGO are unset, the mainnet-readonly RPC is a free public eth_call, and compile costUsd is 0. If a key is ever added, the cap is LLM_DAILY_BUDGET_USD=1. That cap is in-memory and resets on restart, and the guest limit (3/day per IP) is keyed on the Caddy-set XFF.

### Rollback (cmd as admin on VPS)
```
schtasks /end /tn QuiverApi & schtasks /end /tn QuiverWeb
schtasks /delete /tn QuiverApi /f & schtasks /delete /tn QuiverWeb /f
del C:\sites\caddy\sites\quiver.caddy
cd /d C:\sites\caddy && caddy.exe validate --config Caddyfile --adapter caddyfile && caddy.exe reload --config Caddyfile --adapter caddyfile
netsh advfirewall firewall delete rule name="Quiver preview 8091"
:: confirm 8987/4517 free (kill only the node PIDs shown by netstat for those ports), then:
rmdir /s /q C:\sites\quiver
```
Check afterwards that pumpals.fun returns 200.

## 2026-10-27 ~19:00–19:10 Asia/Tehran — web c8bb32b redeploy: HALTED (incident), live preview unchanged
Gate c8bb32b PASSED (qa/gate-web-c8bb32b-report.md). Redeploy started and was stopped before any service change.
- Uploaded C:\sites\quiver\web-c8bb32b.tgz (4,852,122 B, sha256 e1758591…9dc3, matches).
- **Bug 1:** `set R=…&& mkdir %R%` in a single cmd line, so %R% was expanded at parse time. A literal dir `C:\Users\Administrator\%R%` was created and the tarball extracted there. It holds only the c8bb32b source plus a copy of the web .env.production.local (NEXT_PUBLIC_* flags, no secrets). It is still present, not deleted.
- **Bug 2 (INCIDENT):** build-c8bb32b.bat `cd /d` into the non-existent release dir failed, so `npm ci` ran in C:\Users\Administrator, which is the **GMGN project root** (package.json → gmgn-cli ^1.6.9). npm ci reinstalled its node_modules from the unchanged lockfile at 19:04: gmgn-cli still 1.6.9, plus commander, dotenv, ip-address, smart-buffer, socks and undici. package.json and package-lock.json were not modified (mtime 2026-10-24 12:10). The build step then failed (no build script there), so nothing else ran.
- NOT touched: QuiverWeb/QuiverApi tasks, web-start.bat, Caddy, releases\dd9d25f-19e4ba1, pumpals, Obscura.
- Status after: :8091 200 (still dd9d25f+19e4ba1), pumpals.fun 200.
- Leftovers on the VPS (await owner decision): C:\Users\Administrator\%R%\, C:\sites\quiver\web-c8bb32b.tgz, C:\sites\quiver\build-c8bb32b.bat.
- Fix for the retry: create the dir in its own command with a literal path, and add `|| exit /b 1` after `cd` in the bat.

## 2026-10-27 19:05–19:30 Asia/Tehran — web c8bb32b redeploy (guarded retry): DONE
Scope unchanged: public, no auth, dev login on, paper only. Backend stays 19e4ba1. Only \QuiverWeb restarted; Caddy untouched.
- **Cleanup of my leftovers:**
  - C:\Users\Administrator\%R% was verified to hold exactly the 128 tarball files plus the .env.production.local copy (fc shows it identical to the dd9d25f one). It was removed.
  - build-c8bb32b.bat removed.
- **GMGN (read-only, run from C:\sites\quiver):**
  - C:\Users\Administrator\node_modules\gmgn-cli exists and its package.json version is 1.6.9.
  - `node …\gmgn-cli\dist\index.js --version` printed 1.6.9 with exit 0.
  - Not repaired or modified. Its node_modules mtimes are still 19:04 from the incident, with no further change.
- **Build** with the guarded C:\sites\quiver\build-c8bb32b-v2.bat:
  - Literal paths only. Each step does `cd /d C:\sites\quiver\releases\c8bb32b-19e4ba1\web || exit /b 1`, and a check that %CD% equals that path runs before tar, before npm ci and before the build.
  - The output was CWD_OK, CI_OK and BUILD_OK. BUILD_ID is yWZgUfZ25zvnE1mNNRPXS; the old one, dd9d25f, is -GhJ4NuFDqR2C_8A_gtdE.
  - The bat and the tgz (sha256 e1758591…9dc3) were deleted after success.
- **Switch:**
  - web-start.bat was backed up to web-start.dd9d25f.bat, then overwritten with web-start.c8bb32b.bat (cd into the new release).
  - Ran `schtasks /end /tn QuiverWeb`. Old PID 7636 had already exited with the task. Then `schtasks /run /tn QuiverWeb`; the new PID 20440 listens on 127.0.0.1:4517.
  - The served HTML carries the new BUILD_ID.
- **Outside checks (http://91.107.243.172:8091, box browser, plain http, isSecureContext=false):**
  - Guest /app/new makes 0 compile calls and shows Sign in.
  - Real UI sign-in works and sets a 28-character dev label.
  - Markets shows live prices ($217.85, $346.83, $404.84, $769.61, $2,339.31, $72,241.28).
  - Reload keeps the session: 0 refresh calls, 1 exchange, and still 1 auth call at +20s.
  - Paper run run_01M5Z0EAEZJAFFEM9KM4 streams over SSE.
  - A separate stop test showed Stopped within 1s and still Stopped at +32s, with activity frozen.
  - The UI backtest finished after the UI's "Use the allowed range" retry, at 0.00% with the note "No price data for NVDA in this window".
  - Idempotency keys: 4 of 4 unique, 32 characters each.
  - pumpals.fun 200. Ports 4517 and 8987 are closed from outside.
- **Finding (P3, pre-existing, not caused by this diff):**
  - BacktestPanel sends `to = new Date()` from the client, and backend app.ts:281 rejects `to > now`. With any client clock ahead of the server, even by milliseconds, the first POST /v1/backtests returns 422 backtest_range_invalid, and the UI recovers via the clamp.
  - Fix on the owner side: the client should send to = now − a few minutes, or the server should clamp small future skew.
- **Note:** g7.py's stop step skips the inline confirm, so three paper runs from my main-flow passes are still running in API memory. They are paper only, with no funds and no keys. Their dev sessions are gone, and they clear on the next QuiverApi restart, which is out of scope here.
- Screenshots are in shots/robin/vps-c8bb32b/ (app-signed-in, markets and run at 1440 and 390, plus backtest-1440, run-stopped-1440 and guest-new-1440).
- **Rollback:** copy /y C:\sites\quiver\web-start.dd9d25f.bat C:\sites\quiver\web-start.bat, then `schtasks /end /tn QuiverWeb`, then `schtasks /run /tn QuiverWeb`. The dd9d25f-19e4ba1 release is kept intact.

## 2026-10-27 ~19:40 — backend 1695b65 (on top of web c8bb32b)
- This was deployed before the 19:46 steering ("don't deploy 1695b65 if not yet") arrived.
- Release: C:\sites\quiver\releases\c8bb32b-1695b65\backend (tgz sha256 3e3a63e8…). Only QuiverApi was restarted, as PID 22392.
- Backup: api-start.19e4ba1.bat.
- Dev persistence resumed 3 earlier non-stopped runs, with a dev_restart warning. They were left alone, and they are stoppable since the M3.6 fix.
- Outside checks: backtest, run and stop PASS, no ≥400 responses. pumpals.fun 200.

## 2026-10-27 ~20:20 — pair web f918436 + backend 8c6e455
- Release: C:\sites\quiver\releases\f918436-8c6e455\{backend,web}.
  - backend tgz sha256 3882fe38…, web tgz sha256 b0e9ff76…, both matched on the VPS.
  - Built with guarded bats (literal paths, %CD% checks): BUILD_OK for both. Web .env.production.local copied from c8bb32b-19e4ba1 (live, /v1, DEV_LOGIN=1).
- Backups: api-start.1695b65.bat and web-start.c8bb32b-2.bat.
- Only QuiverApi and QuiverWeb were restarted. Both ports were free after /end, so no kill was needed. New PIDs: API 7128 on :8987, web 13132 on :4517. Caddy 12732 untouched.
- Log: mock mode, mainnet-readonly prices loaded, persistence on, SK defaults 250/1000.
- Outside :8091 checks:
  - / returns 200 and has id=safety plus "$200 of NVDA".
  - /#safety: direct load and footer click OK at 360/390/768/1440; header click OK at 768/1440.
  - No overflow. /v1/session-keys/defaults without auth returns 401. pumpals.fun 200.
- Rollback:
  1. `copy /y C:\sites\quiver\api-start.1695b65.bat C:\sites\quiver\api-start.bat`
  2. `copy /y C:\sites\quiver\web-start.c8bb32b-2.bat C:\sites\quiver\web-start.bat`
  3. `schtasks /end` then `/run` for QuiverApi and QuiverWeb.

## 2026-10-27 20:29–20:33 — stopped leftover paper runs
- There were 6 active paper runs, not 3. All belonged to dev test users from my UI checks: the 3 resumed by persistence, plus 3 left by the g7e script, whose stop step is flawed.
  - run_01M5Z0EAEZJAFFEM9KM4, run_01M5Z0NSBWQVNYXSN9G9, run_01M5Z0TXQB10F1949ZGX
  - run_01M5Z2AF91YH81HDG6HN, run_01M5Z2ES8EHRED1ACWTQ, run_01M5Z4C160P08JNW2GVF
- **Incident, caused by me:** to find the run owners I ran `type C:\sites\quiver\data\state.json` over WinRM. That held the file open while the persistence flush ran, and its renameSync of state.json.tmp to state.json threw EPERM. The API exited at about 20:29 and the web stayed up.
  - Fix: `schtasks /run /tn QuiverApi` only. The new API PID is 23044. No other service was touched and the persisted state loaded fine.
  - **Finding (P2, Sage):** src/persist.ts:42 flush must catch and retry EPERM/EBUSY on rename (Windows file locks, AV scans) instead of crashing the process.
  - Ops rule: never read state.json on the VPS while the API is running. Use the API instead, or copy the file first.
- Each run was stopped through the normal flow: dev exchange as its owner, then POST /v1/runs/:id/control {action:"stop"}. All returned 200 and GET shows "stopped". After 40s every owner's /v1/runs list shows only stopped runs.
- :8091 returns 200 and pumpals.fun returns 200.

## 2026-10-27 ~20:47 — backend 7f3c831 (web f918436 unchanged)
- Release: C:\sites\quiver\releases\f918436-7f3c831\backend (tgz sha256 b1969dd6…, matched on the VPS). Built with the guarded bat: BUILD_OK, CWD verified.
- Backup: C:\sites\quiver\api-start.8c6e455.bat. The new api-start.bat line is `cd /d C:\sites\quiver\releases\f918436-7f3c831\backend || exit /b 1`.
- Only QuiverApi was restarted. The port was free after /end, so no kill was needed. New PID 19504. Web 13132 and Caddy 12732 untouched.
- state.json was not read at any point. Persisted state loaded fine: the 6 earlier runs are still "stopped" according to the API.
- Outside checks on :8091:
  - / returns 200;
  - /v1 without auth returns 401;
  - sign-in, backtest, paper run and stop all PASS with no ≥400 responses.
  - pumpals.fun 200.
- Leftover: run_01M5Z5Z4HNP5DNHYYQDD, a paper run from the g7e check, is still active. Its random dev label wasn't saved, there's no admin route, and I didn't read state.json. It's harmless (paper, mock).
- Rollback:
  1. `copy /y C:\sites\quiver\api-start.8c6e455.bat C:\sites\quiver\api-start.bat`
  2. `schtasks /end /tn QuiverApi` then `schtasks /run /tn QuiverApi`.

## 2026-10-28, release a07a90b-5114786 (web a07a90b + backend 5114786). Robin.
- **Release:** C:\sites\quiver\releases\a07a90b-5114786\{backend,web}. Both built on the VPS (BUILD_OK). The web env was copied from f918436-8c6e455. Scope unchanged: paper preview, dev login on, mock mode with mainnet-readonly prices.
- **OPS_TOKEN:**
  - 48 characters, generated on the VPS and stored only in C:\sites\quiver\env\ops.token.
  - ACL: SYSTEM:F and Administrators:F only.
  - Loaded by api-start.bat (`set /p`).
  - Never printed or logged anywhere.
- **Backups for rollback:** C:\sites\quiver\api-start.7f3c831.bat and C:\sites\quiver\web-start.f918436.bat.
- **Restart:** ran schtasks /end then /run for QuiverApi and QuiverWeb. No processes were killed.
  - New PIDs: API 3352 (127.0.0.1:8987) and web 21864 (127.0.0.1:4517).
  - Caddy 12732 and :8090 untouched.
  - The API log shows "ops routes enabled" and the persisted state loaded. state.json was not read.
- **Leftover run:** run_01M5Z5Z4HNP5DNHYYQDD was stopped via the ops route at 09:05 Asia/Tehran. Robin's production UI-gate runs were stopped by stop-all. `ops.bat list` returns an empty list.
- **Outside checks on :8091:**
  - /, /app, /app/settings, /docs, /terms, /brand and /v1/public/landing: 200. Landing has `public, max-age=60` and no private data.
  - /v1/settings without auth: 401.
  - Ops routes with no token or a bad token: 401. After 30 requests: 429. Landing after 60 requests: 429.
  - pumpals.fun: 200.
- **Note:** burst tests from the QA box need a single keep-alive connection, because the box's egress IP rotates.
- **Rollback:**
  1. `copy /y C:\sites\quiver\api-start.7f3c831.bat C:\sites\quiver\api-start.bat`
  2. `copy /y C:\sites\quiver\web-start.f918436.bat C:\sites\quiver\web-start.bat`
  3. Stop the API with POST /v1/ops/shutdown (C:\sites\quiver\up\ops.bat) for a graceful flush, or `schtasks /end /tn QuiverApi`. Then `schtasks /end /tn QuiverWeb`, and `schtasks /run` both tasks.

## 2026-10-28, release 5eb7d5b-e0383b0 (web 5eb7d5b + backend e0383b0). Robin.
- **Gate:** both PASS (gate-backend-e0383b0-report.md, gate-web-5eb7d5b-report.md). Pair 8e93197 + 3619bfe also PASSED but was superseded and never switched to; `releases\3619bfe-8e93197` is unused.
- **Upload:** backend-e0383b0.tgz sha256 81d9fabf…8275 and web-5eb7d5b.tgz sha256 56dafdf9…9213, both verified on the VPS with certutil.
- **Builds:** guarded bats with literal paths, `cd /d … || exit /b 1` and a CWD check before npm. Backend and web both reported BUILD_OK. The web env was copied from a07a90b-5114786.
- **Config check:** the current api-start env loads under e0383b0 (`CONFIG_OK`). No values were printed.
- **Backups for rollback:** `api-start.5114786.bat` and `web-start.a07a90b.bat`, both byte-identical to the previous files. The `a07a90b-5114786` release is kept intact.
- **Switch:** node replaced the release path in api-start.bat and web-start.bat. PowerShell is broken on this VPS (LanguagePrimitives type initializer), so it wasn't used.
- **Stop:** graceful, via `scripts\ops\stop-api.cmd 8987 QuiverApi`, with OPS_TOKEN loaded by `set /p` from env\ops.token and never printed. The API log shows "graceful shutdown (ops)" and "shutdown complete code 0".
  - The script's `timeout` wait fails under WinRM, so the first `schtasks /run` was too early and both tasks came back as Ready.
  - A second `/run` started them.
  - Restarted only QuiverApi and QuiverWeb; the pair needs the web task too. Caddy 12732 untouched; nothing else touched.
- **New PIDs:** API 22052 (127.0.0.1:8987) and web 21412 (127.0.0.1:4517). Persisted state loaded; state.json was not read.
- **Outside checks on http://91.107.243.172:8091:**
  - Pages: 8 pages 200.
  - Landing notice: the Chainlink wording.
  - Run flow: sign-in, backtest, paper run and stop, replay and portfolio all work. A live run is refused with 403.
  - Autopilot: start, then kill → killed, 0 live runs left.
  - Positions IDOR: own 200, foreign and fake 404.
  - Alerts: webhook save with real DNS → 200, then cleared.
  - Landing widths 360/390/768/1440: 0 overflow.
  - Runs: `ops.bat list` shows 0 active runs.
  - pumpals.fun: 200.
- **Rollback:**
  1. `copy /y C:\sites\quiver\api-start.5114786.bat C:\sites\quiver\api-start.bat`
  2. `copy /y C:\sites\quiver\web-start.a07a90b.bat C:\sites\quiver\web-start.bat`
  3. Load OPS_TOKEN with `set /p` and run `stop-api.cmd`, or `schtasks /end /tn QuiverApi`. Then `schtasks /end /tn QuiverWeb`.
  4. Wait about 5 s, then `schtasks /run` both tasks and confirm with netstat that 8987 and 4517 are listening.

## 2026-10-28 ~11:00 Tehran time (UTC+3:30): pair b745156-aaa21a4 NOT deployed
- Backend aaa21a4 gate: PASS. Web b745156 gate: **FAIL** (W1: /c/[token] needs `QUIVER_API_INTERNAL`, which `web-start.bat` doesn't set). See `gate-web-b745156-report.md`.
- Nothing changed on the VPS:
  - live is still `releases\5eb7d5b-e0383b0`;
  - no uploads, no restarts;
  - the `up\` scratch files and `releases\3619bfe-8e93197` are untouched.
- Commands run on the VPS (read-only): `findstr` on `web-start.bat` and on the live release `.env.production.local` (non-secret keys only), and `dir *.bat`.
- Observation: the `*.bat` listing shows no `api-start.5114786.bat` in `C:\sites\quiver`, although the previous entry's rollback refers to it. Verify before relying on that rollback.

## 2026-10-28 12:07 (Asia/Tehran): deployed 51209b8 (web) + 485da53 (backend) as releases\51209b8-485da53
- **Uploads:** backend tgz 328399 bytes and web tgz 5089658 bytes; the sizes on the VPS match the local files. Both build bats printed BUILD_OK.
- **Backups:** api-start.0614d21-aaa21a4.bat and web-start.0614d21-aaa21a4.bat, verified with fc /b.
- **Start bat changes:** repl3 swapped only the release path. BATS_OK; QUIVER_API_INTERNAL and PUBLIC_BASE_URL are still there.
- **Graceful stop:** used the new stop-api.cmd with the token file.
  - Shutdown accepted with activeRuns 0, RC 0, took 1.3 s.
  - The curl config was gone afterwards.
  - The token is not in the logs or the process list, and there is no C:\quiver\secrets\ops_token.
- **Now listening:** API PID 24096 on 8987, web PID 19516 on 4517, Caddy 12732 on 8091.
- **Outside checks:**
  - /, /leaderboard, /docs and /app return 200.
  - Run 201, live 403 mode_not_enabled, stop_and_flatten 200.
  - Card share 201. The card API sends `public, max-age=5`. The /c page returns 200, its og:image is on 91.107.243.172:8091, and the image is a 57 KB png.
  - Revoke 200, after which the card returns 404.
  - Autopilot start 200, kill 200 (stopped 1).
  - Leaderboard 200.
- **End state:** ops list shows 0 active runs; pumpals.fun returns 200.
- **Rollback:**
  1. `copy /y C:\sites\quiver\api-start.0614d21-aaa21a4.bat C:\sites\quiver\api-start.bat`, and the same for web-start.
  2. Stop the API with `releases\0614d21-aaa21a4\backend\scripts\ops\stop-api.cmd` or the new one.
  3. Run `schtasks /end` and then `/run` for QuiverApi and QuiverWeb.
  - releases\0614d21-aaa21a4 is still in place.

## 2026-10-28 12:40 Asia/Tehran: web 4ab4ad6 + backend bcfb936 → releases\4ab4ad6-bcfb936
- Gates: qa/gate-backend-bcfb936-report.md (PASS, 3 Low), qa/gate-web-4ab4ad6-report.md (PASS, 1 Medium docs claim: PARITY.md says refine is done, UI shows "Coming soon").
- Builds: build-be.bat BUILD_OK, build-web.bat CI_OK/BUILD_OK (PUBLIC_BASE_URL=http://91.107.243.172:8091, QUIVER_API_INTERNAL=http://127.0.0.1:8987/v1; .env.production.local copied from 51209b8-485da53).
- Backups: api-start.51209b8-485da53.bat, web-start.51209b8-485da53.bat, fc /b BAK_OK for both.
- Env check (names only, no values printed): api-start.bat sets no LLM_EST_CALL_USD and no CHAIN_READS_ENABLED, no .env file in the release → LLM_EST_CALL_USD uses the new default 0.5 ($0.50 floor) and chain reads stay OFF. Outside: /v1/chain/testnet/status 401 without login.
- Pre-deploy ops list: 0 runs. deploy.bat: REPL_OK api 1 web 1, BATS_OK, stop-api.cmd (token file arg) "API stopped cleanly" activeRuns 0, STOP 12:40:27.53→12:40:28.76, CURL_CFG_GONE, DEPLOY_STOPPED. Then schtasks /run both.
- **Now listening:** API PID 23952 on 8987 (releases\4ab4ad6-bcfb936\backend), web PID 28332 on 4517, Caddy 12732 on 8091.
- Smoke (smoke.py): pages 200, run 201, live 403 mode_not_enabled, share 201, card public max-age=5, og 200 png, stop 200, revoke 200 → card 404, leaderboard 200. Autopilot: the reused smoke user got 409 (left killed by the earlier deploy's smoke); a fresh user: start 200, kill 200 stopped 1. /privacy 307 → /terms#privacy.
- Post: ops list 0 active runs; pumpals.fun 200.
- **Rollback:** copy /y api-start.51209b8-485da53.bat api-start.bat and web-start.51209b8-485da53.bat web-start.bat, stop the API with releases\51209b8-485da53\backend\scripts\ops\stop-api.cmd 8987 QuiverApi C:\sites\quiver\env\ops.token, schtasks /end QuiverWeb, then schtasks /run both.

## 2026-10-28 — backend 90f1c68 (M5.1–6), release 4ab4ad6-90f1c68
- Backups `*.4ab4ad6-bcfb936.bat`. Graceful stop with 0 active runs. API PID 14496. Smoke OK, Privy and LLM fail closed, pumpals.fun 200.
- Rollback: copy api-start.4ab4ad6-bcfb936.bat over api-start.bat, graceful stop, `schtasks /run /tn QuiverApi`.

## 2026-10-28 ~12:58 Tehran — backend 7bb0157 (M5.1–9), release 4ab4ad6-7bb0157
- Web stays 4ab4ad6. Backups `*.4ab4ad6-90f1c68.bat`. Graceful stop with 0 active runs, STOP_RC=0. API PID 9876 on 8987.
- Smoke OK. Privy disabled. Vault unavailable (no master key), so it fails closed. Ops list empty. pumpals.fun 200.
- Rollback: copy api-start.4ab4ad6-90f1c68.bat over api-start.bat, graceful stop, `schtasks /run /tn QuiverApi`.

## 2026-10-28 13:13 Tehran: backend M5.10 (1e554b2 + 5a1120f docs), release 4ab4ad6-5a1120f
- Gate: qa/gate-backend-M5.10-report.md (PASS, 1 Low). SIWE_ORIGIN=http://91.107.243.172:8091 set in api-start.bat. SECRETS/vault master key NOT set, so the vault stays unavailable.
- Backups `api-start.4ab4ad6-7bb0157.bat`, `web-start.4ab4ad6-7bb0157.bat` (BAK_OK). npm ci: 58 packages. deploy3: REPL_OK, BATS_OK, stop-api.cmd with activeRuns 0, STOP 13:13:30.87→13:13:32.07, STOP_RC=0, then `schtasks /run /tn QuiverApi`.
- API PID 20968 on 8987. Smoke OK. Privy 503 auth_unavailable. Vault unavailable. chain status enabled:false. SIWE challenge domain/uri = :8091, chain 46630. Ops list empty. pumpals.fun 200.
- Rollback: copy api-start.4ab4ad6-7bb0157.bat over api-start.bat, then releases\4ab4ad6-5a1120f\backend\scripts\ops\stop-api.cmd 8987 QuiverApi C:\sites\quiver\env\ops.token, then `schtasks /run /tn QuiverApi`.

## 2026-10-28 14:17 Tehran: web 4c5845b, release 4c5845b-5a1120f
- Gate: qa/gate-web-4c5845b-report.md (PASS, 2 Medium + 3 Low, owner Wren).
- Build: web-4c5845b.tgz sha256 127ec2ad…a7c verified. build-web-4c.bat: npm ci took 15 min (993 packages; not hung, so nothing killed), then next build BUILD_OK, BUILD_ID 14:09.
- The unused release 1b1a816-5a1120f is left on disk.
- deployw4c.bat: fc backup OK, REPLW_OK, WEB_BAT_OK (env vars kept), `schtasks /end /tn QuiverWeb`, `/run`.
  - The first start exited (Last Result 1; web.log shows ^C right after Ready, an end/run race).
  - A second `schtasks /run /tn QuiverWeb` worked: web PID 3732 on 4517.
  - There was about 1 minute of 502 on :8091.
- Outside: / /app /app/wallets /app/settings /u/@demo_marco /leaderboard 200. Smoke: run 201, live 403, /c card 200 + OG png, revoke → 404. /r unknown token: noindex (status 200, soft 404 as reported). No did:privy. pumpals.fun 200. API PID 20968 untouched.
- Rollback: copy web-start.4ab4ad6-7bb0157.bat over web-start.bat, `schtasks /end /tn QuiverWeb`, `schtasks /run /tn QuiverWeb` (old release 4ab4ad6-bcfb936 is intact).

## 2026-10-28 14:34 Tehran: backend 6d3a108 (M5.11–15), release 4c5845b-6d3a108
- Graceful stop with 0 runs, then `schtasks /run`. API PID 4404. REPLAY_RENDERER=stub added. Backup `api-start.4ab4ad6-5a1120f.bat`. Superseded below.

## 2026-10-28 15:55 Tehran: backend 86f3fa5 (M5.16–M5.19), release 4c5845b-86f3fa5. Web NOT deployed (0e978a2 gate FAIL)
- Gate: qa/gate-backend-M5.11-15-report.md (PASS). Web: qa/gate-web-0e978a2-report.md (FAIL, /u soft 404). Web stays 4c5845b-5a1120f (PID untouched).
- backend-86f3fa5.tgz (git archive) sha256 f6d27388…0879, matching certutil on the VPS. build-be8.bat: guarded cwd, npm ci, BUILD_OK.
- The first deploy6 run stopped at the guard (UNEXPECTED_VAR) before any stop. The cause was existing **empty** `set TIINGO_API_KEY=` and `set OPENROUTER_API_KEY=` lines (both length 0). The guard was relaxed to allow only empty values. Backup `api-start.4c5845b-6d3a108.bat` (fc identical to the 6d3a108 bat).
- deploy6b: REPL_OK (path only), BATS_OK (SIWE_ORIGIN=http://91.107.243.172:8091, REPLAY_RENDERER=stub). Ops list empty. stop-api.cmd returned activeRuns 0, "API stopped cleanly", STOP 15:55:00.47→15:55:01.70, RC 0. Then `schtasks /run /tn QuiverApi`.
- New API PID 7436 on 127.0.0.1:8987, cmdline in releases\4c5845b-86f3fa5\backend. Still up after more than 60 s. No TIINGO, Telegram, X or SECRETS_MASTER_KEY values set.
- Outside (15:57): status 200; / /leaderboard /app 200; wallet-link challenge 200 with domain :8091; activity 200 with no ids; /search 200 with no ids (81 characters returns 422); media routes 404; vault unavailable, and PUT rpc returns 503 secrets_unavailable; POST /copy {address} returns 501 not_available; NVDA history 1d gives dataSource fallback; 0 runs; pumpals.fun 200.
- Known, with the old web 5a1120f: /r, /c and /u unknown return soft 200. The fix is in the undeployed web.
- Rollback: copy api-start.4c5845b-6d3a108.bat over api-start.bat; run `releases\4c5845b-86f3fa5\backend\scripts\ops\stop-api.cmd 8987 QuiverApi C:\sites\quiver\env\ops.token` with 0 runs; then `schtasks /run /tn QuiverApi` and check port 8987 stays up.

## 2026-10-28 20:32–20:34 Tehran: backend 5637e10 (M5.24) + web b76c459, releases 5637e10-726e6a2\backend and b76c459-5637e10\web
- Gates:
  - qa/gate-backend-M5.24-report.md: PASS, with 1 Medium (deposit getCode fails open) and Lows.
  - qa/gate-web-b76c459-report.md: PASS.
- Backend:
  - sha 29f61e3a…5e69 verified; node_modules robocopied from e6303b3 (lock identical); BE_IMPORT_OK.
  - Backup api-start.726e6a2-e6303b3.bat.
  - ACTIVE_RUNS 0; stop-api.cmd clean (20:32:37→38, RC 0); /end, /run. API PID 2696.
- Web:
  - sha 2927dab7…f779 verified; node_modules robocopied from 726e6a2 (lock identical); .env.production.local copied from 726e6a2-297d8dd.
  - next build OK; 0 token names in .next/static; no motion\proof.
  - Backup web-start.726e6a2-297d8dd.bat, cd line only (fc 11 lines); /end 20:33:33, 4517 free 20:33:34, /run. Web PID 22168.
- Outside checks:
  - / /app /app/new /leaderboard /terms /docs /app/revenue: 200. Unknown /u: 404.
  - testpool `enabled:false`.
  - deposit/prepare without auth: 401.
  - 0 token names in public JS.
  - Load: 120/120 /u 404; pumpals.fun 5/5 200. PumPals 12968 untouched.
- TEST_POOL_ENABLED and REVENUE_ACCOUNTING_ENABLED unset. No TIINGO, Telegram, X or SECRETS_MASTER_KEY. Nothing broadcast.
- Rollback:
  - Web: copy /y web-start.726e6a2-297d8dd.bat web-start.bat; schtasks /end /tn QuiverWeb; wait for 4517 to free; schtasks /run /tn QuiverWeb.
  - Backend: copy /y api-start.726e6a2-e6303b3.bat api-start.bat; releases\5637e10-726e6a2\backend\scripts\ops\stop-api.cmd 8987 QuiverApi C:\sites\quiver\env\ops.token (0 runs); schtasks /run /tn QuiverApi. Live 726e6a2 web is compatible with e6303b3 and 5637e10.

## 2026-10-28 20:43 Tehran: backend ab57b1b (M5.25), release ab57b1b-b76c459\backend (backend only)
- **Gate:** qa/gate-backend-M5.25-report.md, PASS (one Low: bind relies on bind.mjs; SIGNOFF says 8787).
- **Build:**
  - git archive sha256 902cb787d5e0b92c1e3625eb9af40cdd51aa625d5936d17e2b21ddb729322b68, verified with certutil.
  - Lock identical to 5637e10. node_modules robocopied; BE_IMPORT_OK.
- **Swap:**
  - Backup api-start.b76c459-5637e10.bat. The edit changed only the cd line (fc 11).
  - Guard passed: SIWE_ORIGIN :8091, REPLAY_RENDERER=stub, QUIVR_MODE=mock, bind.mjs present, TIINGO empty. No TEST_POOL_, REVENUE_ACCOUNTING, CREATOR_SHARE, SECRETS_MASTER_KEY, Telegram, X, PRIVY_JWKS_MIN or INVALID_PER_USER (defaults apply).
- **Restart:**
  - ACTIVE_RUNS 0. Graceful stop 20:43:37.09 → 20:43:38.25, STOPRC 0. /end, /run 20:43:38.
  - New API PID 21672, 127.0.0.1:8987, cmdline in releases\ab57b1b-b76c459\backend.
  - /v1/health ready:true (warmup finished in 18 s). Still up at 20:46 (> 2 min).
- **Outside checks:**
  - 200: / /app /app/new /leaderboard /terms /docs /app/revenue /v1/health.
  - 404: unknown /u.
  - /v1/testpool/status enabled:false.
  - deposit/prepare without auth: 401.
  - Direct :8987 from outside: timed out (not reachable).
  - Load: 120/120 /u 404; pumpals.fun 5/5 200.
  - Web 22168 (b76c459) and PumPals 12968 untouched.
- **Cleanup:** temp bats deleted from up\ (tarball kept, as before).
- **Rollback:** copy /y api-start.b76c459-5637e10.bat api-start.bat; releases\ab57b1b-b76c459\backend\scripts\ops\stop-api.cmd 8987 QuiverApi C:\sites\quiver\env\ops.token (0 runs); schtasks /end then /run /tn QuiverApi. The web needs no change.

## 2026-10-28 21:04 Tehran: backend bb835c1 (M5.26), release bb835c1-b76c459\backend (backend only); bind.mjs retired
- **Gate:** qa/gate-backend-M5.26-report.md, PASS (M1 Medium: checks.sh fixture-drift step is vacuous; tooling only).
- **Build:**
  - git archive sha256 9c1dab5fc48d97452f90cc73aaa485a9b37ca89b5d5f1b05d47c05b6287c1e7d, verified with certutil.
  - Lock identical. node_modules robocopied from ab57b1b; BE_IMPORT_OK.
- **api-start:**
  - Backup api-start.b76c459-ab57b1b.bat.
  - Edits: cd line now points to bb835c1-b76c459. `set NODE_OPTIONS=--import=file:///C:/sites/quiver/bind.mjs` became `set NODE_OPTIONS=` (bind.mjs was the only entry). `set PORT=8987` kept. No HOST line, so the default 127.0.0.1 applies.
  - Guards passed: SIWE :8091, stub renderer, mock mode. No TEST_POOL_, REVENUE, SECRETS, Telegram, X, PRIVY_JWKS_MIN, INVALID_PER_USER or bind.mjs. TIINGO empty.
  - The machine environment has no HOST or NODE_OPTIONS.
  - C:\sites\quiver\bind.mjs file left in place (unused).
- **Restart:** ACTIVE_RUNS 0. Graceful stop 21:04:46.22 → 21:04:47.39, STOPRC 0. /end, /run 21:04:47.
- **New API PID 14080:**
  - netstat shows **only `127.0.0.1:8987` LISTENING** (no 0.0.0.0 or [::]).
  - Boot log: `host=127.0.0.1 port=8987`.
  - Direct 91.107.243.172:8987 from outside timed out.
  - /v1/health ready:true (warmup 18 s). Still up at 21:07 (> 2 min).
- **Outside checks:**
  - 200: / /app /app/new /leaderboard /terms /docs /app/revenue /v1/health.
  - 404: unknown /u.
  - /v1/testpool/status enabled:false.
  - deposit/prepare without auth: 401.
  - Load: 120/120 /u 404; pumpals.fun 5/5 200.
  - Web 22168 and PumPals 12968 untouched.
  - Temp bats deleted from up\.
- **Rollback (restores ab57b1b *with* bind.mjs):**
  1. In C:\sites\quiver: copy /y api-start.b76c459-ab57b1b.bat api-start.bat
  2. releases\bb835c1-b76c459\backend\scripts\ops\stop-api.cmd 8987 QuiverApi C:\sites\quiver\env\ops.token (0 runs)
  3. schtasks /end /tn QuiverApi, then schtasks /run /tn QuiverApi
  4. Confirm netstat shows 127.0.0.1:8987 only.
