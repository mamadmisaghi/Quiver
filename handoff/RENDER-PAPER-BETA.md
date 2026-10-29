# Quiver: Render paper beta preparation

Updated 2026-10-29. This supersedes the storage/backtest portions of the earlier readiness audit.

Provider follow-up: see `PROVIDER-SETUP-2026-10-29.md`. Credentials have since been supplied and checked, a model selected, and persistent AI cost accounting implemented. The source repository is now `mamadmisaghi/Quiver`. Earlier credential/repository and process-local AI-budget notes below describe the previous checkpoint.

## Shipped frontend behavior

- The existing Site stays at https://quiver-studio.gofivahootan.chatgpt.site with its current audience and visual identity.
- Draft-specific compilation and browser-local saving remain available.
- `Test these rules` now evaluates the actual submitted strategy using the original engine, fees, slippage and synthetic bars. It no longer returns fixed example metrics. It is a rule simulation, not evidence of historical market performance.
- Preview evaluation is bounded to 31 days/800 bars/12 signals/8 triggers/8 actions, and validates the strategy. It has no credentials or trading authority.
- Preview market names and IDs now come from the same registry as compilation/backtesting. Added explicit MSFT and Solana SOL mock instruments to preserve the existing catalog.
- `/v1/*` now has a same-origin bridge for the future fixed HTTPS Render API. It isolates the refresh cookie, streams SSE/NDJSON, blocks operator paths and rejects cross-origin mutation requests. It is dormant until `QUIVER_API_INTERNAL` is configured.

## Backend implemented and checked locally

- PostgreSQL adapter with initial schema migration, atomic JSONB checkpoints, revision checks and a connection-scoped advisory writer lock. Success responses await the durable commit; storage loss blocks mutations and makes readiness return 503.
- Storage includes users, strategy versions, runs/events, backtests, autopilot state, encrypted user secrets, share records, refresh sessions, idempotency responses, slippage caps and paper-engine checkpoints.
- Paper checkpoints preserve cash, positions, fees, realized PnL, daily risk counters, trigger/cooldown state, processed intent IDs, pending approvals/orders and equity history. Paused, halted and stopped runs keep their state. Incompatible legacy runs stop explicitly instead of resetting their account.
- Async shutdown waits for the final commit and closes PostgreSQL before exit. Engine shutdown blocks further waves/ticks. Simultaneous duplicate idempotent saves share the same result.
- Interrupted backtests become failed with a retry message; interrupted replay renders return to their queue.
- Production refuses missing durable storage/JWT configuration. Mainnet execution cannot be enabled through configuration alone.
- Jupiter's runtime price endpoint uses `api.jup.ag/price/v3` with optional `JUPITER_API_KEY`; the older verified artifact is preserved as historical evidence.
- Node production bundle, Dockerfile with FFmpeg, non-root application process and replay-disk ownership initialization are provided.

## Deployment is prepared, not applied

`render.yaml` provisions a dedicated API and PostgreSQL database. It uses the smallest paid web compute compatible with the required always-on engine/replay disk (0.5c-512mb), a 0.1c-256mb database with 1 GB storage and a 1 GB replay disk. No Redis instance is created because this beta does not have a Redis worker implementation.

The attached disk is intentional: Render stops the old instance before starting the replacement. The database writer lock requires this single-engine deployment model. Do not remove the disk, enable overlapping deployments or scale the API to multiple instances. Deploys have a short interruption.

The Blueprint passes Render's current public JSON Schema. CLI v2.33.0 was installed in scratch, but platform-aware validation cannot proceed without an explicitly selected Render workspace and CLI authentication. No infrastructure has been created or charged.

The connected Render account exposes workspace **GOFi**. Render requires the user to identify the workspace before resource operations. The Site source is currently in the Sites Git service, which Render's Git-backed flow cannot clone. A private GitHub/GitLab/Bitbucket repository accessible to Render is still needed. No matching Quiver repository was found under the connected GitHub owner.

## Inputs needed next

1. Identify the Render workspace (GOFi is the available candidate).
2. Provide a private source repository accessible to the connected GitHub account and Render; the monorepo layout and root `render.yaml` must be preserved.
3. Configure `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, allowed website origins and login methods in a Quiver-specific Privy app.
4. Configure `OPENROUTER_API_KEY`, a compatible `LLM_MODEL`, optional vision model, provider credit and cost limit. The Blueprint starts with a $5/day application limit, not a guarantee against external provider billing; set provider-side limits as well.
5. For real historical results, configure the chosen data provider (initial Tiingo adapter exists). For chain reads, configure the appropriate RPC provider.

Internal JWT/encryption/operator secrets are generated by Render. Never place them in Git or browser code. Configure provider secrets in the deployment environment, not in chat or checked-in files.

## Activation sequence after inputs

1. Push the prepared source to the private repository; confirm its Render Git integration.
2. Validate the Blueprint against the selected workspace and apply it; inspect the exact deployment to a terminal state and verify `/v1/ready` plus an authenticated paper workflow.
3. Set Site server environment `QUIVER_API_INTERNAL=https://<actual-render-host>/v1`. Rebuild with `NEXT_PUBLIC_API_MODE=live` and a public Privy app ID as required by the existing auth UI. Keep `NEXT_PUBLIC_API_BASE=/v1`; the browser uses the same-origin bridge. Do not expose the app secret or provider keys.
4. Verify login/refresh, AI text/image/refinement, save/reopen across server restart, real-data backtest, start/pause/stop, SSE reconnect and history. Browser-local preview drafts need an explicit import path into the authenticated account.
5. Only then test each venue's actual execution adapter on its test environment; mainnet stays disabled.

## Known limits and remaining implementation

- This is a single-instance paper-beta checkpoint store, not normalized multi-worker/mainnet accounting. Snapshot cost grows with retained history. Backups, retention/compaction, load testing and recovery on the actual Render PostgreSQL transport remain to be verified.
- The backend defaults to synthetic prices. Hyperliquid live data/execution, Polymarket real event mapping, complete Solana execution and verified Robinhood venues still require their respective integrations; no trading adapter was made real in this change.
- AI and Privy end-to-end checks await the project's credentials. Secrets alone do not complete all integrations.
- Alert delivery queues/settings and global in-flight AI cost reservations are still process-local. Persist/reconcile these before treating notifications or provider spend limits as restart-safe.
- Graph nodes are still read-only. Structured editing, account draft import, unsaved-change handling, responsive/keyboard polish, rewards and final fee/token rules remain.
- No mainnet broadcast, deposits or real-money orders were performed. GeoIP/policy and signer/grant lifecycle are not production approved.

## Verification

- Frontend TypeScript and production build; backend TypeScript and production Node bundle.
- 21 preview integration checks: input-specific graphs, saved drafts, rule simulation, limits, canonical registry, API bridge, cookie isolation, cross-origin/operator/path rejection and stream forwarding.
- 9 targeted durable-storage/shutdown tests, including actual PostgreSQL SQL/JSONB through PGlite and a database close/reopen. Running, paused, halted and stopped paper account state and duplicate intent protection are covered. PGlite does not verify the network/TLS behavior of a real Render database.
- Existing persistence/shutdown tests passed; 38 generated extension fixtures are current.
- Last full backend run: 545 passed, 5 failed, 9 skipped (559 tests). The five failures remain in the pre-existing local TLS/pinned-network cases in `m421`/`m513`; cause is not proven. Three additional checkpoint status cases were subsequently added and passed in the targeted run. No all-green full-suite claim.
- Local browser: a BTC strategy generated four matching nodes; `Test these rules` completed with computed equity/costs and explicit synthetic-data labels.
- Docker image build could not be run here because a Docker runtime is unavailable. Actual Render deploy, RPC/provider connections, physical mobile/touch and external security review remain unverified.

Official Render references were read directly: Blueprint spec, compute plans, disks, environment variables, private networking and CLI documentation. The live JSON Schema was used for structural validation.
