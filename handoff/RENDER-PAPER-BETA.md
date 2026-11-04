# Quiver Workspace release handoff

## Release target

The existing Workspace Site serves the frontend. The pending Render rollout adds one always-on Node API and one PostgreSQL database. The API owns market observation, account isolation, quote checkpoints and testnet reconciliation. Browser-only paper sessions remain available on the Site until the frontend switches to the connected API.

The source is on the existing [Quiver release PR](https://github.com/mamadmisaghi/Quiver/pull/1). Review and deploy the tested revision. The Blueprint uses one instance, an attached replay disk, manual deploys, a private database and the `/v1/ready` probe. The PostgreSQL advisory lock prevents two engine processes from taking orders at the same time. Render stops the old disk-backed service before starting its replacement. [Render persistent disks](https://render.com/docs/disks)

## First connected release

1. Create the Blueprint from the release revision when the paid Render workspace is available. The Blueprint connects the database internally and generates the JWT, operations and 32-byte vault secrets. Keep the first vault key in an appropriately protected recovery store.
2. In the project’s Privy configuration, allow the exact public Site origin. Set `PRIVY_APP_ID` and `PRIVY_APP_SECRET` on the API. Set the matching public app ID on the frontend. The backend verifies the identity token server-side. Link a Phantom wallet with its one-time ownership message or a verified Privy identity.
3. Configure the server’s AI and equity-data provider credentials from the existing private configuration. The paid API and public-preview AI budgets are separate. The API reserves estimated costs before requests and persists charges. The Blueprint caps the API at USD 5 per day with three simultaneous requests. Recheck the configured model pricing before enabling a different model.
4. Set the Site server variable `QUIVER_API_INTERNAL=https://<deployed-api>/v1`. Rebuild the frontend with `NEXT_PUBLIC_API_MODE=live`, `NEXT_PUBLIC_API_BASE=/v1` and the public Privy ID. The existing same-origin proxy forwards the request. Keep provider credentials on the server.
5. From the checkout run `node services/backend/scripts/ops/preflight.mjs`. Run with `--env` in the configured service environment and `--api=https://<deployed-api>` to check PostgreSQL readiness and production login. The checks print only setting names and status.
6. Through the public Site, sign in, save a workflow, run it in paper mode, close the tab and return after two observations. Pause the run, restart the service and verify that positions, fees, active duration and the paused checkpoint survive. Import browser drafts through Strategies and archive old paper history under Paper trades. Imported balances do not enter the portfolio or rankings.

## Execution evidence

| Venue | Available from this release | Activation evidence |
| --- | --- | --- |
| Hyperliquid | Public quotes and paper execution. A testnet-only agent, encrypted at rest, supports isolated entries, scoped order confirmations, cancellation and receipt reconciliation. Supported saved workflows can run automatically or require entry review. A partial fill holds downstream stages. | Enable `HL_TESTNET_ORDERS=true` only on the prepared durable API. Verify an owner-signed grant, available test USDC, a real testnet order, cancellation or fill and exchange receipts. The app’s local disable removes the signer. The owner can also revoke the grant at the exchange. |
| Solana / Jupiter | Phantom ownership, finalized SOL balance, exact-in quotes scoped to mints and amounts, unsigned simulation, signature binding and a finalized receipt reader. Quotes expire. Simulation requires evidence of token and native fee changes. | Supply an authorized Jupiter swap API key and trusted `SOLANA_READ_RPC` for execution previews. Confirm real provider response coverage. Mainnet broadcast remains gated. |
| Robinhood Chain | The existing linked-wallet testnet swap flow can verify the exact prepared transfer, pool event, runtime identities and finalized block. Wallet inclusion is shown separately from settlement. | Supply the deployed pool and token identities, operator-verified runtime hashes and genesis in `RH_TESTPOOL_PINS`, and an archive-capable RPC on 46630. Complete one test-token round trip. |
| Polymarket | Selected outcomes supply conditions and historical observations. | No order-signing key is used for signals. |

The Hyperliquid testnet runner accepts fully resolved, fixed-USD, one-off perpetual entries with supported conditions and full-fill dependencies. Its readiness endpoint names unsupported repetitions, protective exits, funding rules, sizing and mixed-network stages before activation. The account pause stops new paper entries, disables the signer and preserves external positions for inspection. Mainnet activation and unattended mixed-venue cash execution require further integration and end-to-end qualification. Changing hosting or a feature flag cannot enable them.

Historical replay uses completed Hyperliquid candles, exact Polymarket outcomes and configured Tiingo equity bars. Each market reports coverage. Workflows that cannot be evaluated have no performance result. Historical replay, imported browser history and synthetic fixtures do not rank as observed production paper performance.

## Recovery

Run `bash services/backend/scripts/ops/database-backup.sh backup /secure/path/quiver.dump` from a trusted shell with a matching PostgreSQL client and `DATABASE_URL` in its environment. The custom-format backup is private. Set `QUIVER_EMPTY_RESTORE_URL` to a **new empty database** and run the same command with `restore`. Restore data and the execution hold are committed together. Store the original vault key separately. Rotate authentication tokens for a recovery cutover.

Start the restored API with testnet orders disabled. It clears refresh sessions, pauses recovered paper runs, drops signers and holds execution intents. Compare unresolved client order IDs against the venue before issuing a new grant. PostgreSQL contains session checkpoints and execution state. Back up replay-disk files separately when video retention is needed. Plan-specific retention and recovery windows are set by Render. [Render PostgreSQL backups](https://render.com/docs/postgresql-backups)

## Verification commands

Run `npm ci`, `npm run typecheck`, `npm run build`, `npm test` and `npm run test:execution` inside `services/backend`. The suite includes file-backed PostgreSQL close/reopen, timed approval and control races, duplicate dispatch prevention, partial-fills and cross-stage recovery, exchange signing vectors, Solana wire evidence, Robinhood receipts and historical replay. The web type check and packaged Worker build are separate from the Node API build. A funded exchange receipt, a Privy production login and a Render recovery drill require their respective external environments.
