
## 2026-10-28 16:43–17:05 Tehran — backend M5.20 85377f4 + web 4eaca8b (Robin)
Gates: `qa/gate-backend-M5.20-report.md` PASS, `qa/gate-web-4eaca8b-report.md` PASS (1 Low).
- Uploads verified with certutil SHA256: backend-85377f4.tgz 0c455a7a…ea44, web-4eaca8b.tgz da569a96…5b88.
- Builds: `releases\4c5845b-85377f4\backend` BUILD_OK. `releases\4eaca8b-85377f4\web` npm ci + next build OK, BUILD_ID present, .env.production.local copied from 4c5845b-5a1120f.
- Backups (made with copy + fc): `api-start.4c5845b-86f3fa5.bat`, `web-start.4c5845b-86f3fa5.bat` (pre-switch web bat), `web-start.4c5845b-85377f4.bat` (web bat right before the web switch, which still points at 5a1120f).
- **API attempt 1 at 16:43:** 0 runs, graceful stop OK. The first `/run` hit the end/run race and the second only ran once the task was Ready. The node child then sat idle at startup for more than 5 min (likely blocked in the pre-listen mainnet-readonly `market.refresh()` RPC while npm ci was loading the box).
  - **Rolled back at 16:52:** killed exact PIDs 12360/15472 (new release tsx, verified), restored the 86f3fa5 bat (fc OK). 86f3fa5 was up at 16:53:54. API downtime was about 16:43–16:54.
  - Diagnosis: ran the new release standalone (mock, no secrets, own dev store) and it listened in under 40 s. **Slip:** it bound 0.0.0.0:18987 for about 1 min because bind.mjs was not in NODE_OPTIONS; killed exact PIDs 15164/18640/23428. Diag files deleted.
- **API attempt 2 at 16:58:** 0 runs, graceful stop at 16:58:55 (activeRuns 0, clean), port free, `schtasks /end` then `/run`. Listening 127.0.0.1:8987 at 16:59:25, **PID 12428**, command line points at 4c5845b-85377f4. Still up at 17:00:38 (+73 s).
- **Web at 17:01:** web-start.bat now points at `4eaca8b-85377f4\web`. `/end`, 4517 free at 17:01:22, `/run`, listening at +12 s with **PID 2620**. Still up at 17:02:50.
- Outside checks via :8091:
  - /v1/public/profiles/@demo_lena and @demo_marco 200 (noindex, max-age=30); @nobody_here_zz 404
  - /u/@nobody_here, /u/%40nobody_here, /u/..%2f..%2fops, /r/nope, /c/nope 404 (x-robots-tag noindex)
  - /u/@demo_marco, /u/@demo_lena, /, /app, /app/new 200
  - real /c card 200 (dev user, paper run created, then stopped)
  - pumpals.fun 200; PumPals :8090 PID 12968 untouched
- Env unchanged (REPLAY_RENDERER=stub, SIWE_ORIGIN, blank TIINGO/OPENROUTER, no TG/X/SECRETS_MASTER_KEY).
- Deleted `releases\4c5845b-bd0ec27` (exact path; findstr found 0 hits in *.bat; no process used it).
- **Rollback:**
  1. Check for 0 runs.
  2. Stop with `releases\4c5845b-85377f4\backend\scripts\ops\stop-api.cmd 8987 QuiverApi C:\sites\quiver\env\ops.token`.
  3. `copy /y api-start.4c5845b-86f3fa5.bat api-start.bat`, then fc.
  4. `schtasks /end` then `/run /tn QuiverApi`.
  5. For the web: `copy /y web-start.4c5845b-85377f4.bat web-start.bat` (5a1120f web), `schtasks /end /tn QuiverWeb`, wait for 4517 to be free, `/run`.
- Note for future deploys: always `schtasks /end` before `/run`, and allow up to about 5 min for API startup (it waits on the RPC before listening).

## 2026-10-28 17:13–17:23 Tehran — backend M5.21 297d8dd (Robin)
- Tarball sha256 3058f626…5125 (certutil matched). Built into `releases\4c5845b-297d8dd\backend`, BUILD_OK.
- 17:16:23 0 runs. `api-start.bat` backed up to `api-start.4c5845b-85377f4.bat` (fc OK). Path repl 85377f4→297d8dd. Guards OK (SIWE, stub, old path gone, no INTERNAL_PROXY_TOKEN/TRUST_PROXY_PEERS/WARMUP_MAX_MS line).
- 17:16:26 graceful stop with the 85377f4 stop-api.cmd (activeRuns 0, clean). 17:16:38 `/end` then `/run`. Health answered at 17:16:49 (warming). Warmup ready 17:17:00. Still up at 17:17:54, **PID 10268** (297d8dd). PumPals PID 12968 untouched.
- 17:18:21 Caddy: backed up `Caddyfile.before-M5.21` and `sites\quiver.caddy.before-M5.21` (fc OK). Added `request_header -X-Quiver-Internal-Token` in the :8091 block only. Validate OK, graceful reload (PID 12732 unchanged). All sites same codes before and after (pumpals.fun 200, www 301, trader 302, :80 302, :8080 401, obscura 200, :8091 200). http://pumpals.fun returns 500 both before and after, from the box (pre-existing).
- Outside: profiles 200/200/404, /u /r /c 404 noindex, /u demo, /, /app, /app/new 200, real /c card 200 (paper run created then stopped, 0 runs after). Spoofed token: 60×200 then 15×429.
- Rollback: 0 runs; `stop-api.cmd` from `releases\4c5845b-297d8dd\backend\scripts\ops\` (same args); `copy /y api-start.4c5845b-85377f4.bat api-start.bat`; `schtasks /end` then `/run /tn QuiverApi`. Caddy: `copy /y sites\quiver.caddy.before-M5.21 sites\quiver.caddy`, then validate and reload.

## 2026-10-28 17:50–17:54 Tehran — backend 297d8dd + web c9d669f with INTERNAL_PROXY_TOKEN
- Token: 48-char base64url, generated on the VPS with node crypto into `C:\sites\quiver\env\internal.token`. Never printed. icacls: inheritance removed, SYSTEM:F and Administrators:F only (same as ops.token).
- Bats: backed up `api-start.4c5845b-297d8dd.bat` and `web-start.4eaca8b-85377f4.bat`. Both now have line 4 `set /p INTERNAL_PROXY_TOKEN=<C:\sites\quiver\env\internal.token`. web-start now does `cd /d C:\sites\quiver\releases\c9d669f-297d8dd\web || exit /b 1`.
- Web build: `releases\c9d669f-297d8dd\web`, BUILD_OK, 0 static files contain the header name. Env: API_MODE=live, API_BASE=/v1, DEV_LOGIN=1.
- API: 0 runs; stop-api.cmd stopped it cleanly; /end then /run. PID 1628, warmup ready after 17 s.
- Web: /end; 4517 free; /run. PID 11704. Both up on the same PIDs more than 60 s later. Runs back to 0.
- Outside, from the VPS: 120 unknown /u in about 10 s gave 120×404. pumpals.fun gave 200 at all 4 probes during the load. A spoofed X-Quiver-Internal-Token on /v1/public/leaderboard gave 30×200 then 45×429 (no bonus bucket).
- Outside, from the box: pumpals 200, www 301, IP 302, :8080 401, trader 302, obscura 200. :8091 /, /app, /app/new and /leaderboard 200; /u/@demo_lena 200; /u, /r and /c unknown 404. The Caddy strip line is still in place.
- Rollback:
  - Web: `copy /y web-start.4eaca8b-85377f4.bat web-start.bat`, then `schtasks /end /tn QuiverWeb`, wait for 4517 to be free, then `schtasks /run /tn QuiverWeb`.
  - Backend, token off: `copy /y api-start.4c5845b-297d8dd.bat api-start.bat`, then 0 runs, then stop-api.cmd (297d8dd scripts\ops, args `8987 QuiverApi C:\sites\quiver\env\ops.token`), then /end, then /run.
  - The token file can stay (it is ACL'd).

## 2026-10-28 19:20 Tehran: web 726e6a2 (master; Ellis motion + Wren Lows) with API 297d8dd unchanged (Robin)
- Release `C:\sites\quiver\releases\726e6a2-297d8dd\web`: built on the VPS from a `git archive` tarball, with `.env.production.local` copied from c9d669f-297d8dd (live mode, dev login). BUILD_ID `_fs77J8mHE4Kk7IeOUt9q`.
- Static chunks contain 0 `INTERNAL_PROXY_TOKEN`/`OPS_TOKEN` names.
- `web-start.bat` was backed up as `web-start.c9d669f-297d8dd.bat`. Only the `cd /d` line changed (to 726e6a2-297d8dd). Same env, same token file line.
- `/end QuiverWeb`, 4517 confirmed free, `/run` (19:20:36). The API was not restarted. Other sites' PIDs are unchanged: relayer, pumpals and the API.
- Checks:
  - 8 routes and /v1/health return 200 from outside.
  - Live HTML carries the new BUILD_ID.
  - Unknown /u: 30/30 404 from outside, 120/120 404 under load from the VPS.
  - pumpals.fun 200 (1/1 outside, 5/5 from the VPS).
- **Rollback:** `copy /y C:\sites\quiver\web-start.c9d669f-297d8dd.bat C:\sites\quiver\web-start.bat`, then `schtasks /end /tn QuiverWeb`, wait for 4517 to be free, and `schtasks /run /tn QuiverWeb`. The previous release folder is intact.

## 2026-10-28 19:41 and 19:49 Tehran: backend 0c96c48 (M5.22), then e6303b3 (M5.23); web 726e6a2 unchanged (Robin)
- 19:41: `releases\0c96c48-726e6a2\backend` (sha c356212b…). Backup `api-start.726e6a2-297d8dd.bat`. Graceful stop with 0 runs, `/end`, `/run`. Ready at 19:41:33.
- 19:49: `releases\e6303b3-726e6a2\backend` (sha 30ef5215…). Backup `api-start.726e6a2-0c96c48.bat`. Only the cd line changed. Guards OK, and there are no REVENUE_ or TEST_POOL_ vars. Stop with 0 runs, `/run` at 19:49:22. Ready at 19:49:42. **PID 21544.**
- Checks: outside 200s, testpool disabled, revenue off, /u 404 120/120, pumpals.fun 200 ×5. Nothing broadcast.
- Rollback: 0 runs, then stop-api.cmd from the e6303b3 `scripts\ops` (args `8987 QuiverApi C:\sites\quiver\env\ops.token`), then `copy /y api-start.726e6a2-0c96c48.bat api-start.bat` (or `…726e6a2-297d8dd.bat` for 297d8dd), then `/end` and `/run /tn QuiverApi`.
