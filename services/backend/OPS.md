# Operations (M3.7)

## Operator token
`OPS_TOKEN` (optional, ≥32 random chars) turns on `/v1/ops/*`. Unset: every ops route answers 404.
Send it as `Authorization: Bearer <OPS_TOKEN>`. Generate it yourself, for example
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`, and keep it in the job's
environment, not on a command line. All ops calls are rate limited (30/min per IP) and audited.

| Route | Enabled when | Purpose |
|---|---|---|
| `POST /v1/ops/shutdown` | `OPS_TOKEN` set (any mode) | 202, then graceful stop: stop run timers, flushSync dev store, close server, exit 0 |
| `GET /v1/ops/runs?status=active\|all` | `OPS_TOKEN` set, mock/testnet, NODE_ENV≠production, not chain 4663 | list paper/testnet runs with owner label |
| `POST /v1/ops/runs/:id/stop` | same as above | stop one orphan run by id (idempotent; `alreadyStopped`) |

Live runs are never listed or stopped through ops routes.

## Graceful shutdown
All of these go through one path (`src/shutdown.ts`): stop runs → `flushSync` → close server → exit 0
(watchdog: exit after 1.5 s if sockets hang, state is already flushed).

- Ctrl+C (SIGINT), Ctrl+Break (SIGBREAK), console window closed (SIGHUP on Windows; ~10 s grace before Windows kills it),
  SIGTERM (POSIX kill/systemd/docker).
- `POST /v1/ops/shutdown`.

**Not graceful:** `schtasks /end`, `taskkill /F` and Task Manager "End task" call TerminateProcess. No handler runs,
so up to ~2 s of dev-store writes can be lost. The atomic temp+rename save keeps the file valid either way, and on boot
a complete `.tmp` newer than the main file is now preferred.

## Recommended Windows stop procedure (Robin)
1. Set `OPS_TOKEN` in the scheduled task's environment, then restart the task once so it picks the token up.
2. To stop: `scripts\ops\stop-api.cmd [PORT] [TaskName]` (cmd + curl.exe, no PowerShell needed; also reads
   `QUIVER_PORT` / `QUIVER_TASK`), or `powershell -ExecutionPolicy Bypass -File scripts\ops\stop-api.ps1 -Port <PORT> -Task <TaskName>`.
   Both default to the VPS values: port **8987**, task **QuiverApi**
   (with `OPS_TOKEN` in that shell's env). It calls `/v1/ops/shutdown`, waits up to 10 s for the port to close, and
   falls back to `schtasks /end` only if the API is still listening.
3. If you run it in a visible console instead, Ctrl+C or closing the window is graceful.

## Orphan paper runs
```
curl -s -H "Authorization: Bearer $OPS_TOKEN" http://127.0.0.1:<PORT>/v1/ops/runs
curl -s -X POST -H "Authorization: Bearer $OPS_TOKEN" http://127.0.0.1:<PORT>/v1/ops/runs/<runId>/stop
```
(The VPS orphan `run_01M5Z5Z4HNP5DNHYYQDD` is Robin's to stop after deploying M3.7. The ops routes only work on that box
if it runs in mock/testnet mode, NODE_ENV is not production, and OPS_TOKEN is set.)
