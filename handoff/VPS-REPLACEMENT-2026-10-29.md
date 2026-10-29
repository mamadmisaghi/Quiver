# Quiver: replace the earlier Windows VPS preview

## Authorized scope

On 29 October 2026 the owner explicitly requested replacing the earlier Quiver deployment on the existing German Windows VPS with the latest project source, then continuing development there. They do not want to run diagnostic commands manually and have confirmed the VPS capacity is sufficient. Do not request the hardware diagnostic script again.

Target: `91.107.243.172`, supplied RDP port `33096`. Credentials must remain outside Git, logs and command arguments. This authorization covers Quiver only; do not remove unrelated Caddy sites, services or data.

## Current evidence and blocker

- The existing Quiver preview at `http://91.107.243.172:8091` responds. Its public health endpoint returned 200 with `ok:true`, `ready:true`; auth config reported `privy.enabled:false` and `devLogin:true`. It is the earlier preview, not proof that the latest provider/persistence changes have been deployed.
- The supplied RDP session cannot be operated with the tools exposed in this conversation. Direct management sockets are unavailable from this execution environment.
- The existing HTTP WinRM endpoint responds and advertises Negotiate authentication. Its NTLM challenge returned a local computer/domain identity, which was used to verify the account format.
- A read-only WinRM login was attempted using the supplied administrator credential with NTLM message encryption required. It was rejected. The same supplied account was tried once with the server-confirmed local-domain prefix; it was also rejected. These results do not prove that the password fails for RDP. Do not keep retrying credentials, disable certificate validation, enable plaintext WinRM, or remove authentication.
- No remote shell was obtained. No old deployment was stopped/deleted, no files or services were changed on the VPS, and no new deployment is live. Establish a working authenticated management channel before applying the replacement.

## Source and native runtime preparation

Latest GitHub project baseline: `704eab95b2025ed397db63f009f266c83999aa09`; Render hardening branch: `b166b2d0e7f8b280389f45cf4f23c3e8e9c03ace`. The latter adds Frankfurt placement, direct Node container shutdown and a configured vision-model regression assertion. Do not copy an old archived web/backend tree over this current application.

The root default build/start scripts target the existing Cloudflare/Vinext Site. For this VPS use the explicit native Node/Next commands:

- `npm run build:vps`: native `next build` into `.next`.
- `npm run start:vps`: native `next start`, bound to `127.0.0.1`. Set `PORT=4517` in its service environment.
- Backend: its own frozen `npm ci`, `npm run typecheck`, `npm run build`, then native `node services/backend/dist/main.js` from the repository root.

Four pending optional package lifecycle scripts are explicitly disabled in `pnpm-workspace.yaml` (`@reown/appkit`, `bufferutil`, `keccak`, `utf-8-validate`). Approved required native builds such as esbuild and sharp remain enabled. Dependency versions and the frozen lockfile are unchanged.

The native build initially revealed that the source's three `use cache` pages require `cacheComponents:true`. This flag is now enabled in `next.config.ts`; the native production build then passed. Frontend TypeScript and all 21 existing preview integration checks passed as well. These are local Linux checks of the native Node/Next runtime, not a successful build on Windows or deployment to the VPS. The local build used the existing HTTP preview origin only for build verification; production sign-in still requires the HTTPS step below. The current published ChatGPT Site was not rebuilt or changed.

## Replacement procedure once management access works

1. Inspect the existing Quiver task definitions and launchers plus the Quiver-specific Caddy block. Reuse the established ports: API `127.0.0.1:8987`, web `127.0.0.1:4517`, public Caddy `:8091` until a verified HTTPS origin is ready. Do not disturb the other site blocks.
2. Archive the current Quiver source, launchers, task definitions, environment files and data to a private dated backup. The owner wants the old preview retired; the archive is for rollback, not continued public operation. Do not put secrets into a public archive or GitHub.
3. Prepare a new immutable release directory and build both applications before replacing the running tasks. Retain the previous release until the new workload is verified.
4. Provision a dedicated PostgreSQL instance/data directory for this project using a supported Windows version and a service account suitable for PostgreSQL. Bind it to loopback and use its direct session connection, not transaction pooling: the current checkpoint adapter holds a session advisory writer lock. Do not repurpose another project's database. Generate JWT, encryption, internal-proxy and operator secrets on the server.
5. Configure production backend environment: `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=8987`, durable `DATABASE_URL`, `QUIVR_DEV_PERSIST=0`, `DEV_LOGIN_ENABLED=false`, `QUIVR_MAINNET_ENABLED=false`, supplied Privy/OpenRouter/Tiingo settings, selected GPT-4.1 Mini text/vision models and the existing AI spending/concurrency limits. Use the actual Windows FFmpeg path and persistent local replay directory. Keep paper-price provenance explicit; hosting does not complete missing live venue integrations.
6. Build the web in live API mode with `NEXT_PUBLIC_API_MODE=live`, `NEXT_PUBLIC_API_BASE=/v1`, `NEXT_PUBLIC_DEV_LOGIN=0` and the actual public origin. Runtime SSR uses `QUIVER_API_INTERNAL=http://127.0.0.1:8987/v1` and the server-only internal proxy token. The existing Caddy block proxies public `/v1/*` directly to the API; preserve that route and do not weaken the HTTPS-only visitor bridge to accommodate a loopback server connection.
7. Configure an actual verified HTTPS hostname before production login: refresh cookies are Secure, Privy needs the correct allowed origin, and bare HTTP is not a production sign-in solution. Do not claim a hostname/domain has been deployed without DNS/TLS verification.
8. Use existing operator controls to stop the previous Quiver API cleanly, then switch Quiver launchers/tasks to the new release. Run independently of an interactive RDP login, start at boot and restart on failure. Retire the old active release after successful checks.
9. Verify health/readiness, actual production auth config, login/refresh, AI compile/refinement, ownership isolation, durable save/reopen, source-labelled backtest, paper start/pause/stop, stream reconnection and restart recovery. Check service logs without printing credentials. Roll back to the archived release if the replacement is not ready.

The previously deployed public ChatGPT Site remains unchanged. Do not present a local build or a saved source branch as a successful VPS deployment.
