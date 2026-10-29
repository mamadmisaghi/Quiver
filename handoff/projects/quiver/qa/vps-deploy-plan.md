# Quiver preview — Windows VPS deploy plan (PREPARED, NOT EXECUTED)
Target 91.107.243.172 (Windows). Nobody has connected. Do not run until the gate passes (web ≥994f663 re-gated, P1s fixed or accepted).

## Scope / invariants
- Devnet / paper only: QUIVR_MODE=mock, HL_NETWORK=testnet, PRICE_SOURCE=mainnet-readonly (read-only prices), QUIVR_MAINNET_ENABLED=false. No keys with funds on the box.
- Add ONE new file `C:\sites\caddy\sites\quiver.caddy`. Do **not** edit the PumPals or Obscura blocks or the main Caddyfile (assumes it already `import sites/*.caddy`; verify read-only first).
- Ports bound to 127.0.0.1 only: web 4317, api 8787 (check free: `netstat -ano | findstr ":4317 :8787"`; if taken pick 4517/8987).

## Layout
```
C:\sites\quiver\releases\<sha>\{web,backend}   C:\sites\quiver\current -> junction to release
C:\sites\quiver\env\backend.env  web.env       C:\sites\quiver\logs\   C:\sites\quiver\backups\
```
## Build (on the VPS, Node 22 LTS)
- backend: `npm ci` (tsx run, no build). web: set build env then `npm ci && npm run build`:
  `NEXT_PUBLIC_API_MODE=live NEXT_PUBLIC_API_BASE=https://quiver.<domain>/v1 NEXT_PUBLIC_DEV_LOGIN=1` (dev login only because preview is basic-auth gated).
## Env — backend.env (secrets entered by the user on the box, never committed/logged)
```
PORT=8787  QUIVR_MODE=mock  CHAIN_ID=46630  HL_NETWORK=testnet
PRICE_SOURCE=mainnet-readonly  MAINNET_READONLY_RPC_URL=https://rpc.mainnet.chain.robinhood.com
QUIVR_JWT_SECRET=<64 random bytes, user generates>  CORS_ORIGINS=https://quiver.<domain>
TRUST_PROXY=true   (Caddy is the only ingress; Caddy must set X-Forwarded-For from CF-Connecting-IP)
DEV_LOGIN_ENABLED=true   # RISK: label = identity. Acceptable ONLY behind basic auth below.
OPENROUTER_API_KEY=<user>  LLM_DAILY_BUDGET_USD=10  LLM_USER_DAILY_COMPILES=20
QUIVR_DEV_PERSIST=1  QUIVR_DEV_PERSIST_PATH=C:\sites\quiver\data\state.json  NODE_ENV=production
```
web.env: `PORT=4317 HOSTNAME=127.0.0.1 NODE_ENV=production`.
## Services (NSSM preferred; Scheduled Task fallback)
- `nssm install quiver-api "C:\Program Files\nodejs\node.exe" "node_modules\tsx\dist\cli.mjs src\main.ts"` AppDirectory=current\backend, AppEnvironmentExtra from backend.env, stdout/err → logs\api.log, rotate 10MB, restart on exit (delay 5s).
- `nssm install quiver-web node.exe "node_modules\next\dist\bin\next start -p 4317 -H 127.0.0.1"` AppDirectory=current\web.
- Fallback: Task Scheduler "At startup", run whether logged on or not, restart every 1 min ×999.
- Firewall: no inbound rule for 4317/8787.
## Caddy — C:\sites\caddy\sites\quiver.caddy
```
quiver.<domain> {
  basic_auth { preview <bcrypt hash from `caddy hash-password`> }
  encode zstd gzip
  header { X-Content-Type-Options nosniff  Referrer-Policy strict-origin-when-cross-origin  X-Frame-Options DENY  -Server }
  handle /v1/* {
    reverse_proxy 127.0.0.1:8787 {
      flush_interval -1                     # SSE + NDJSON compile stream
      header_up X-Forwarded-For {http.request.header.CF-Connecting-IP}
      transport http { read_timeout 0 }
    }
  }
  handle { reverse_proxy 127.0.0.1:4317 }
}
```
Validate: `caddy validate --config C:\sites\caddy\Caddyfile` then `caddy reload` (reload, not restart — PumPals/Obscura stay up). Note SSE via EventSource can't send basic-auth headers cross-origin; same-origin is fine (browser reuses credentials).
## Cloudflare DNS (user adds)
- `A  quiver  91.107.243.172  Proxied (orange)`. SSL mode Full (strict) — Caddy needs a cert: use CF Origin Certificate in the block (`tls C:\sites\caddy\certs\quiver.pem quiver.key`) or DNS-01; HTTP-01 fails behind proxy only if port 80 is blocked.
- Cloudflare: disable "Rocket Loader"; no caching on /v1/*; SSE needs proxy timeout >100s → heartbeat 15s already keeps it alive.
## Backups
- Daily task 03:00: copy `data\state.json` + env files → `backups\YYYYMMDD\` (keep 14). Before each deploy: zip current release + data.
## Deploy steps
1. Upload release to `releases\<sha>`; npm ci/build; 2. stop quiver-web/api; 3. repoint `current` junction; 4. start services; 5. smoke: `curl -u preview:… https://quiver.<domain>/v1/health`, /, /app/markets, one SSE run, check no 5xx in logs; 6. caddy reload only if quiver.caddy changed.
## Rollback
Stop both services → junction `current` to previous `releases\<sha>` → restore `data\state.json` from pre-deploy backup → start → smoke. Remove/rename quiver.caddy + `caddy reload` fully withdraws the site without touching others.
## Pre-launch blockers
P0/P1 from gate report; zod bump; security headers (also set in app); refresh cookie Secure; DEV_LOGIN off before any public (non-basic-auth) exposure.
