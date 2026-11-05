# Quiver provider setup — 2026-10-29

## Credentials and provider checks

The owner supplied OpenRouter, Privy and Tiingo credentials. Secret values are stored as protected server environment variables for the existing Quiver Site; they are not in source, GitHub, this report or browser code. The Node service on Render still needs these values in its environment when provisioned.

Live read-only checks succeeded:

- OpenRouter: authenticated key endpoint returned 200; actual paid model requests succeeded.
- Privy: app settings returned 200 for the app named **Quiver**. Both current and existing JWKS URLs returned 200 with two verification keys. Email and EVM wallet login are enabled; Solana wallet login is currently disabled. The app's allowed domain list is empty; configure the final production origin in Privy before public-beta login QA.
- Tiingo: daily AAPL history returned 200 with five bars; hourly AAPL history returned 200 with twelve bars. This verifies access for those requests, not redistribution/licensing rights or every market/range.

## Model choice

Initial text and vision model: `openai/gpt-4.1-mini`.

The current OpenRouter catalog lists $0.40 per million input tokens and $1.60 per million output tokens. A complex two-rule request with NVDA, Polymarket odds and leveraged ETH RSI produced valid rules for $0.001766 in one direct call. Full compiler tests, including validation/repair, produced valid English and Persian strategies for approximately $0.003145 and $0.002942 respectively. These are measured examples, not a fixed price per strategy or a broad quality benchmark.

GPT-5 Mini and GPT-5.1 were also tested. Their first outputs for the same sample failed local validation. The chosen model passed that initial sample and costs less for this workload; all outputs still require schema/semantic validation and user review.

## Implementation changes

- Selected text/vision models and token-price estimates are declared in the Render Blueprint.
- Reasoning models use supported GPT-5 parameters rather than unsupported temperature=0; endpoints must support the requested structured-output parameters.
- Compiler prompts specify numeric percentage/hold defaults and keep independent conditions in separate rules. Invalid outputs remain subject to repair/validation.
- Optional instruction-operation fields are not sent through incompatible provider strict mode. Zod and strategy/risk validation remain authoritative.
- AI call/total deadlines are 20/45 seconds, with a matching longer visitor-proxy deadline. The prior eight-second call deadline was too short for actual provider requests.
- Daily AI usage and in-flight cost reservations now survive PostgreSQL restarts. Reservations commit before a paid request; settled costs commit afterward. Unknown timeout costs and recovered reservations count conservatively against the daily limit.
- Initial application limit is $5/day, 4,000 output tokens per call and three concurrent calls. Provider-side limits remain an independent control; application limits are not a provider billing guarantee.

## Publication and remaining activation

- Repository: `mamadmisaghi/Quiver`, created by the owner. Source and brand assets are imported without credentials.
- The published Site still runs its explicit preview compiler/synthetic rule simulation. Staging keys does not silently switch public visitors to paid AI or a mock login.
- The owner selected **GOFi** on Render and agreed to retain the Hobby workspace while using paid service/database compute. The persistent Node API is prepared but not yet deployed. The selected API compute plan is `1c-2g` (1 CPU, 2 GB RAM, $25/month); the database is `0.1c-256mb` ($6/month), with explicitly selected 1 GB database storage and a 1 GB replay disk. Budget approximately $32/month for this Quiver stack before taxes, extra usage, provider API charges and unrelated workspace resources. Workspace Pro is not included or required for this configuration.
- The immediate owner step is adding a payment method in [Render Billing](https://dashboard.render.com/billing) with GOFi selected, while retaining Hobby. Render invoices service, database and storage usage together at workspace level; this is not a separate prepaid checkout for each resource. No paid Quiver resource has been created and no payment has been made by this conversation at this point.
- After deployment: copy the provider secrets into Render, set the Site's fixed API URL, switch the frontend to the authenticated live adapter, and verify login/refresh plus the entire save/backtest/paper-run flow.
- Mainnet execution remains disabled. Venue execution adapters and funding/grant permissions are separate work.

## Verification

- 53 targeted backend tests passed, including provider request parameters, cost reservation ordering, timeout accounting, recovered daily usage, existing budget concurrency, Privy, Tiingo, strategy instruction behavior and durable paper storage.
- The existing 21 preview integration checks and frontend/backend type/build checks remain applicable. The five previously recorded TLS/pinned-network test failures have not been claimed fixed.
- No private key, seed phrase, real-money order or mainnet broadcast was used.
