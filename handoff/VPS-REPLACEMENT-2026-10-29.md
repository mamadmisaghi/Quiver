# Quiver: replace the earlier Windows VPS preview

> **Stopped by the owner on 29 October 2026.** The owner abandoned the VPS path after reporting another error from the runtime initializer; the failing stage and any partial initialization are unknown. Do not retry, continue, clean up or deploy on that VPS as part of the current work. The selected path is now GOFi on Render: Hobby workspace, paid `1c-2g` API and a paid small PostgreSQL instance. Retain this document as a record of the earlier attempt.

## Authorized scope

On 29 October 2026 the owner explicitly requested replacing the earlier Quiver deployment on the existing German Windows VPS with the latest project source, then continuing development there. They do not want to run diagnostic commands manually and have confirmed the VPS capacity is sufficient. Do not request the hardware diagnostic script again.

Target: `91.107.243.172`, supplied RDP port `33096`. Credentials must remain outside Git, logs and command arguments. This authorization covers Quiver only; do not remove unrelated Caddy sites, services or data.

## Current evidence and blocker

- The existing Quiver preview at `http://91.107.243.172:8091` responds. Its public health endpoint returned 200 with `ok:true`, `ready:true`; auth config reported `privy.enabled:false` and `devLogin:true`. It is the earlier preview, not proof that the latest provider/persistence changes have been deployed.
- The supplied RDP session cannot be operated with the tools exposed in this conversation. Direct management sockets are unavailable from this execution environment.
- The existing HTTP WinRM endpoint responds and advertises Negotiate authentication. Its NTLM challenge returned a local computer/domain identity, which was used to verify the account format.
- A read-only WinRM login was attempted using the supplied administrator credential with NTLM message encryption required. It was rejected. The same supplied account was tried once with the server-confirmed local-domain prefix; it was also rejected. These results do not prove that the password fails for RDP. Do not keep retrying credentials, disable certificate validation, enable plaintext WinRM, or remove authentication.
- The owner subsequently confirmed an authenticated local `Test-WSMan` succeeds for the machine-qualified administrator account. The remote client still receives 401 through its HTTP proxy. No 4624/4625 event matched the client's explicit `QUIVER-CODEX` workstation marker; earlier failed-password events from a different workstation are not attributable to this client. The external authentication failure's cause remains unresolved.
- The owner's listener inventory shows HTTP on 5985 only, with no HTTPS listener. `Cert:\LocalMachine\My` returned no certificates. An HTTPS name-mismatch observed by the remote client is therefore not evidence of a misconfigured existing WinRM HTTPS certificate on this VPS.
- No remote shell was obtained. The owner ran the prepared script from their RDP session and reported `QUIVER_PREPARE_OK`: source `6bf2906b`, Node v24.22.0, release `C:\sites\quiver\releases\r-20261029-220200-88d8bf6f-6bf2906b`, web build ID `NHUMbCwCq09SoDmxtX13R`. This is evidence of a successful build on the actual Windows VPS. The report explicitly has `activated:false`; the old public deployment has not been replaced. Continue via bounded owner-run scripts while inbound management remains unavailable.

## Source and native runtime preparation

Latest GitHub project baseline: `704eab95b2025ed397db63f009f266c83999aa09`; prepared native Windows source: `6bf2906bf46b8745ee14dc3601fc5f6d1a7cb261` (includes the prior Render hardening). Do not copy an old archived web/backend tree over this current application.

The root default build/start scripts target the existing Cloudflare/Vinext Site. For this VPS use the explicit native Node/Next commands:

- `npm run build:vps`: native `next build` into `.next`.
- `npm run start:vps`: native `next start`, bound to `127.0.0.1`. Set `PORT=4517` in its service environment.
- Backend: its own frozen `npm ci`, `npm run typecheck`, `npm run build`, then native `node dist/main.js` with `services/backend` as its working directory so the verified read-only registry resolves correctly.

Four pending optional package lifecycle scripts are explicitly disabled in `pnpm-workspace.yaml` (`@reown/appkit`, `bufferutil`, `keccak`, `utf-8-validate`). Approved required native builds such as esbuild and sharp remain enabled. Dependency versions and the frozen lockfile are unchanged.

The native build initially revealed that the source's three `use cache` pages require `cacheComponents:true`. This flag is now enabled in `next.config.ts`; the native production build then passed. Frontend TypeScript and all 21 existing preview integration checks passed as well. The initial checks were local Linux checks; the owner's subsequent `QUIVER_PREPARE_OK` confirms the preparation steps also completed on Windows. The build used the existing HTTP preview origin only for preparation; production sign-in still requires the HTTPS step below. The current published ChatGPT Site was not rebuilt or changed.

## Build preparation from the owner's RDP session

`scripts/vps/prepare-release.ps1` provides a bounded alternative while inbound management access is unresolved. The owner can download this script at an immutable commit, verify its supplied SHA256 and run it in PowerShell 7 on the VPS. It downloads the pinned `6bf2906b` source archive over verified HTTPS and requires archive SHA256 `0e273f5aee424e6482d2905bf3ef0d292a17b78e0dd697c0f953deced1c2800b` before extracting or executing source.

It uses the existing Node.js 24+ installation, installs pnpm 11.25.0 only into its own run directory, installs the existing frozen dependency locks, checks backend/contracts types, builds the backend, runs the 21 preview checks and builds native Next.js with its frontend type check. Output and step logs stay under `C:\sites\quiver\up\prepare-<run>`, with the source/build under a unique `releases\r-<run>-6bf2906b` directory. It stops on a failed step and restores its process environment.

The script creates no service, task, database, firewall rule or management listener and does not activate a release. It requires no provider credentials. Its result explicitly records `activated:false`; a `QUIVER_PREPARE_OK` is evidence of the Windows build only. The HTTP origin used for this preparation matches the earlier preview; rebuild with the verified final HTTPS origin before production activation. Database, secret configuration, backup, task switch and restart checks below remain necessary.

## Dedicated runtime initialization from RDP

`scripts/vps/initialize-runtime.ps1` is the next owner-run, commit-pinned script. It requires the reported Windows build ID and the expected existing Quiver/Caddy paths. It backs up the two launchers, task XML, Quiver Caddy configuration and legacy environment into a private directory. The live JSON state is deliberately copied only after a clean stop at activation, to avoid interfering with the old writer's rename.

It installs the official PostgreSQL 17.11-5 Windows binaries, pinned to the publisher's SHA256 `80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f` ([publisher checksum](https://get.enterprisedb.com/postgresql/postgresql-17.11-5-windows-x64-binaries.zip.sha256)). It creates a dedicated `QuiverPostgres` Windows service, data directory and application database/role. The service runs as NetworkService, starts automatically with restart-on-failure actions, and listens only on `127.0.0.1:55432`. Passwords are generated and retained in an Administrators/SYSTEM-only directory, passed to initdb through a temporary private file, and never included in command arguments. A committed probe is read after restarting this dedicated service. No unrelated database or service is repurposed.

The script adds a separate, marked Caddy preparation block for `https://quiver.91.107.243.172.sslip.io`, validates the full imported configuration and reloads the existing process. It preserves the earlier `:8091` block. The new HTTPS hostname serves only a readiness probe/preparation response until activation. Certificate verification is required; an unverified hostname is reported as `QUIVER_RUNTIME_PENDING_HTTPS`, not as production-ready. A Caddy validation/reload failure restores this script's prior site file. Existing active/new launchers or a non-preparation production block cause the initializer to stop before restarting the database.

Finally it returns an RSA-3072 public key (`publicKeySpki`) and SHA256 fingerprint. The private key remains in the protected server directory. The next transfer can encrypt the already-supplied provider configuration for this specific VPS; no plaintext provider key needs to be committed or requested again. A runtime initialization report still has `activated:false`. Do not claim the database, TLS or service setup has succeeded until the owner returns the actual report or equivalent live evidence.

## Replacement procedure via authenticated shell or owner-run scripts

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
