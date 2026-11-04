# Quiver Workspace release handoff

The existing Workspace Site serves the website. Its application runtime switches to the connected API when the private Site environment contains QUIVER_API_INTERNAL. The Render Blueprint provisions one always-on Node API, one private PostgreSQL instance and the replay disk. The resource names are retained so an existing installation can upgrade in place.

## Connect the release

1. Deploy the reviewed source revision in render.yaml. Keep the service at one instance with its disk attached. Readiness requires the PostgreSQL writer lease and a healthy durable store. Keep the generated vault key across deploys and store an operator backup separately.
2. Configure the production Privy app with the Workspace origin, Ethereum and Solana wallets. Supply PRIVY_APP_ID and PRIVY_APP_SECRET to the API. Transfer the existing private OpenRouter and Tiingo configuration using the secret stores. The base execution routes use the public venue APIs and user-owned funded wallets. Dedicated RPC or Jupiter credentials can improve throughput.
3. Pin the Site's QUIVER_API_INTERNAL to the HTTPS origin of that API and republish the existing Site. The API returns the public Privy app ID for login. The Site already holds the private origin-signing credential. The Blueprint contains only its public counterpart. Stock orders require a recent signed edge country and matching eligibility. The browser cannot choose this value.
4. From the release source, run the environment, API and Site checks in services/backend. The environment check prints pass/fail labels. Preserve its output without storing credentials. Use a production test account to verify login, strategy save, the server-observed paper flow, funding and venue permissions. For launch acceptance, have the wallet owner authorize a small reviewed order and check its actual final venue receipt before enabling broader access.

Commands from services/backend:

    npm ci
    npm run typecheck
    npm run build
    npm run test:execution
    npm test
    node scripts/ops/preflight.mjs --env --profile=live --api=https://YOUR-RENDER-HOST --site=https://quiver-workspace.gofivahootan.chatgpt.site
    npm run verify:mainnet

The final command performs credential-free, read-only venue checks. It may report unavailable routes outside an issuer's session or during public RPC throttling. CI runs deterministic receipt, grant and retry fixtures. It never asks a wallet to sign.

## Execution and custody

| Market | Owner authorization and settlement |
| --- | --- |
| Hyperliquid perpetuals | A linked EVM owner signs orders or authorizes a trade-only agent on mainnet. Quiver applies its sizing and risk limits at dispatch. Venue order identifiers and fills determine position size and partial closes. Revoke at the venue to remove its trading authority. |
| Solana spot | A linked Solana wallet signs an exact Jupiter swap. The runner verifies the mints, balances, simulation and finalized token movements. Optional unattended USDC buys use a separate Privy execution wallet, exact SPL allowance, and a scoped policy on supported direct Raydium pools. The receipt UI exposes the allowance and its revocation. Other routes request an owner signature. |
| Robinhood Chain stock tokens | A verified issuer asset and eligible account are required on chain 4663. The owner signs a token approval, when needed, and a separate reviewed Uniswap swap. Actual finalized swap logs determine the fill. The order stays pending if the venue outcome is unknown. |
| Polymarket | Resolved outcomes can supply a condition. Quiver places no prediction-market bets. |

Fund each origin account in its settlement asset. Supply native network gas where applicable. The app does not bridge or withdraw across venues. Stages with dependencies wait for verified fills. Live quotes, issuer eligibility, supported leverage and liquidity are checked at the time of an order. Stop and revoke prevent new dispatches. Orders already in flight may settle and open positions remain the owner's until closed. Monitored exits require a connected observer and a usable signing mode. Platform fee on these routes is zero.

## Recovery

The backend reconciles stored order identities after restarts. For an EVM order claimed before the wallet prompt closed, inspect the original sender and nonce. The owner can use the wallet's replacement or cancel flow at that same nonce. Quiver waits for a finalized original or replacement. Never replay a transaction from an ambiguous acknowledgment.

Run bash services/backend/scripts/ops/database-backup.sh backup /secure/path/quiver.dump with a matching PostgreSQL client and DATABASE_URL. Configure QUIVER_EMPTY_RESTORE_URL to a new empty database before restore. Restore applies an execution hold. Keep the original vault master key and rotate auth secrets for a recovery cutover. Review external orders, balances and grants against the venue. Reconcile or revoke outstanding authorities and explicitly reauthorize affected trading before resuming.
