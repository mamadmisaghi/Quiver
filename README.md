# Quiver web

    npm install
    npm run dev -- -p 4317          # dev
    npx next build && npx next start -p 4317   # prod preview (scripts/restart.sh does this)

- Default mode is mock (`lib/mock.ts`, marked `// MOCK`): no backend calls. Live mode talks to the backend, see below.
- Placeholder motion lives in `src/motion/` (see its README) behind `data-motion` hooks; Ellis owns the final motion. Every page works with motion off.
- Screenshots: `python3 scripts/shots.py <outdir> <width> [reduce] /path:name ...` → `shots/` (gitignored).
- Page map + wireframes: `docs/`.

## Data & motion
- `NEXT_PUBLIC_API_MODE=mock|live` (default mock), `NEXT_PUBLIC_API_BASE` (default /v1). Adapters in lib/api/{mock,live}.ts, all payloads zod-parsed against lib/contracts.
- Motion lives in src/motion (Ellis). Disabled for reduced motion / coarse pointers; every page works without it.
- Dev: `sh scripts/restart.sh` (build + start on :4317).

## Running against a local backend
The backend's CORS is a strict allowlist (api-contracts §17): `CORS_ORIGINS` must list exact origins (scheme + host + port, comma-separated). Wildcards (`*`) make the server refuse to start. Use the web origin exactly as the browser sees it:

    # backend/  (pick your own free port; 8793 belongs to someone else)
    DEV_LOGIN_ENABLED=true CORS_ORIGINS=http://localhost:4317 PORT=8795 QUIVR_DEV_PERSIST=0 npx tsx src/main.ts

    # web/
    NEXT_PUBLIC_API_MODE=live NEXT_PUBLIC_DEV_LOGIN=1 NEXT_PUBLIC_API_BASE=http://localhost:8795/v1 sh scripts/restart.sh

`http://127.0.0.1:4317` is a different origin from `http://localhost:4317`. List both if you use both. See `.env.example` (no secrets). Keep real values in an untracked `.env.local`.

Auth rate limits: `/auth/exchange` and `/auth/refresh` can return 429. The client backs off (it uses Retry-After, otherwise 2s, 4s, 8s, up to 3 retries) and shows a quiet "Retrying in Ns" pill.

### M3.5 backend notes (api-contracts §19)

- **Dev login is off by default.** `NEXT_PUBLIC_DEV_LOGIN=1` only shows the web Sign in button; the backend must also run with `DEV_LOGIN_ENABLED=true` (refused when `NODE_ENV=production` or on mainnet). Without it, Sign in shows an error and screens stay signed out. A preview with dev login on must sit behind HTTP basic auth.
- **Stream tickets are single-use.** `api.streamRun` reads SSE with `fetch` (never native `EventSource`), fetches a new `POST /stream-tickets` ticket on every connect and reconnect, and resumes with `since` + `Last-Event-ID`.
- **Caps.** 429 `limit_exceeded`: 5 active paper runs and 10 open streams per user; streams retry after `retryAfter` (5 s).
- **Assets.** The API sends `Content-Security-Policy: default-src 'none'` and `Cross-Origin-Resource-Policy: same-site`. Never load images, fonts or scripts from the API origin; serve them from `public/`.

## Server-side environment

| Variable | Used by | Default | Notes |
|---|---|---|---|
| `QUIVER_API_INTERNAL` | Server-side fetches: `/c/[token]` page, its OG image, `/leaderboard` first render | absolute `NEXT_PUBLIC_API_BASE`, else `http://127.0.0.1:8987/v1` | Must be absolute. Required in spirit when `NEXT_PUBLIC_API_BASE` is relative (`/v1`, VPS proxy). VPS `web-start.bat`: `set QUIVER_API_INTERNAL=http://127.0.0.1:8987/v1` |
| `INTERNAL_PROXY_TOKEN` | Server-side calls only (`proxy.ts` checks for `/u`, `/r`, `/c`; `/r`, `/c`, `/leaderboard` server fetches) send it as `X-Quiver-Internal-Token`, and only when the API base is loopback (`127.0.0.1`/`localhost`) | unset → no header | Server-only secret: never prefix with `NEXT_PUBLIC_`; must match the backend value (≥32 chars). Robin generates it; never commit it. The visitor's `X-Forwarded-For` is never forwarded. `/u/:handle` lookups are cached in-process ~30 s (200/404 only). |
| `PUBLIC_BASE_URL` | `metadataBase` in `app/layout.tsx` → absolute `og:image` / `twitter:image` | unset (Next falls back to localhost) | Set at **build and start** time (static pages read it at build, dynamic ones like `/c/[token]` at runtime). VPS: `http://91.107.243.172:8091` |

## Sign-in and wallet linking (M5.2)

- The sign-in UI reads `GET /v1/auth/config`. Privy (`@privy-io/react-auth`, loaded on demand) shows only when `privy.enabled`; otherwise the dev login (`NEXT_PUBLIC_DEV_LOGIN=1`) is the fallback. A `503 auth_unavailable` from `/auth/exchange` is shown as a calm status.
- `NEXT_PUBLIC_PRIVY_APP_ID` (optional, empty by default) is a fallback for the public app id. Privy secrets (`PRIVY_*`) live only on the backend; see backend docs. Never put them in the web env.
- Chain: Robinhood Chain **testnet 46630** only. No mainnet is configured.
- Wallet link (Wallets page and the "Connect wallet" menu): challenge → `personal_sign` after an explicit click → verify. Unlink asks for confirmation. Max 5 wallets.
