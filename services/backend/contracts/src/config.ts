// Runtime config schema. Mock/testnet boot with placeholders unset; mainnet fails closed.
import { z } from "zod";
import { EvmAddress } from "./common";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");
const opt = z.string().min(1).optional();

export const RawConfig = z.object({
  QUIVR_MODE: z.enum(["mock", "testnet", "mainnet"]).default("mock"),
  CHAIN_ID: z.coerce.number().pipe(z.union([z.literal(46630), z.literal(4663)])).default(46630),
  QUIVR_MAINNET_ENABLED: bool.default(false),
  QUIVR_TREASURY: EvmAddress.optional(),
  QUIVR_FEE_ROUTER: EvmAddress.optional(),
  QUIVR_DEPLOYER: EvmAddress.optional(),
  QUIVR_FEE_BPS: z.coerce.number().int().min(0).max(100).default(30),
  PRIVY_JWKS_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(30_000).transform((v) => Math.max(v, 10_000)), // M5.25: JWKS refetch cooldown, floor 10 s
  INVALID_PER_USER_PER_MIN: z.coerce.number().int().min(0).max(10_000).default(60), // M5.25: per-user cap on invalid (422/413) requests; 0 = off
  QUIVR_TOKEN_ADDRESS: EvmAddress.optional(),
  AA_PROVIDER: z.literal("alchemy").default("alchemy"),
  ALCHEMY_API_KEY: opt,
  ALCHEMY_GAS_POLICY_ID: opt,
  /** M4.0: alert delivery provider. webhook works; email/telegram are stubs (deliveries end not_configured). */
  ALERTS_PROVIDER: z.enum(["webhook", "email", "telegram", "x"]).default("webhook"),
  TELEGRAM_BOT_TOKEN: opt, // M5.14: set = real Telegram sender (Bot API); empty = not_configured
  X_ALERTS_TOKEN: opt, // M5.14: OAuth2 user token with dm.write; set = real X DM sender; empty = not_configured
  /** M4.0 placeholders for the stub providers (unused until implemented). */
  ALERTS_EMAIL_API_KEY: opt, ALERTS_TELEGRAM_BOT_TOKEN: opt,
  GAS_SPONSORSHIP_ENABLED: bool.default(false),
  SIGNER_BACKEND: z.enum(["kms", "privy", "local_dev"]).default("local_dev"),
  KMS_KEY_RING: opt, AWS_REGION: opt,
  LLM_PROVIDER: z.literal("openrouter").default("openrouter"),
  OPENROUTER_API_KEY: opt,
  LLM_MODEL: opt,
  LLM_VISION_MODEL: opt,
  SECRETS_MASTER_KEY: opt, // M5.9 placeholder: 32 bytes as 64 hex or base64. Unset = user secrets disabled (503 secrets_unavailable). // M5.6: chart-screenshot compile; must be a vision-capable OpenRouter model (default openai/gpt-4o-mini)
  LLM_DAILY_BUDGET_USD: z.coerce.number().positive().default(50),
  // M4.9.1/M4.9.2: reserved before each call; the reservation is max(this, priced worst case, largest call seen today). Floor $0.50.
  LLM_EST_CALL_USD: z.coerce.number().positive().max(10).default(0.5).transform((v) => Math.max(v, 0.5)), // values below the floor are raised, never fail boot
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(32_000).default(4000), // sent as max_tokens, so a call's output is bounded
  LLM_MAX_INPUT_TOKENS: z.coerce.number().int().min(1000).max(200_000).default(16_000), // worst-case prompt size for the priced estimate
  LLM_PRICE_IN_PER_MTOK: z.coerce.number().nonnegative().optional(), // model price, USD per 1M input tokens (optional)
  LLM_PRICE_OUT_PER_MTOK: z.coerce.number().nonnegative().optional(), // USD per 1M output tokens (optional)
  LLM_MAX_INFLIGHT: z.coerce.number().int().min(1).max(64).default(4), // concurrent LLM calls across the API
  LLM_USER_DAILY_COMPILES: z.coerce.number().int().positive().default(30),
  DATA_VENDOR_API_KEY: opt,
  BACKTEST_EQUITY_SOURCE: z.enum(["free_eod", "vendor", "none"]).default("free_eod"),
  CHAINLINK_STREAMS_CLIENT_ID: opt, CHAINLINK_STREAMS_SECRET: opt,
  HL_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  GEO_BLOCKED_COUNTRIES: z.string().regex(/^([A-Z]{2})(,[A-Z]{2})*$/).default("US,CA,GB,CH,AE"),
  GEO_IP_DB_PATH: opt,
  TERMS_VERSION: z.string().default("draft-0"),
  PINATA_JWT: opt,
  DATABASE_URL: opt, REDIS_URL: opt,
  PRIVY_APP_ID: opt, PRIVY_APP_SECRET: opt,
  /** M5.2: optional PEM (SPKI, ES256) verification key from the Privy dashboard; unset → JWKS from auth.privy.io (cached 10 min). */
  PRIVY_VERIFICATION_KEY: opt,
  PRIVY_JWKS_URL: z.string().url().optional(),
  /** M3.9: session-key expiry in hours (replaces SK_*_EXPIRY_DAYS). SessionAccount has no on-chain max; 168 h is the platform cap. */
  SK_DEFAULT_EXPIRY_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  SK_MAX_EXPIRY_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  SK_DEFAULT_PER_TX_USD: z.coerce.number().positive().default(250),
  SK_DEFAULT_DAILY_USD: z.coerce.number().positive().default(1000),
  MAINNET_USER_DAILY_CAP_USD: z.coerce.number().positive().default(1000),
  MAINNET_ALLOWLIST_ONLY: bool.default(true),
  MULTILEG_FAILURE_POLICY: z.literal("leave_and_alert").default("leave_and_alert"),
  UNISWAP_API_KEY: opt, UNISWAP_ROUTE_MODE: z.enum(["api", "onchain"]).default("api"),
  ZEROX_API_KEY: opt,
  HOST: z.string().min(1).default("127.0.0.1"), // M5.26: listen host; loopback by default (Caddy fronts it). Replaces the VPS bind.mjs preload.
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  /** HMAC secret for access JWTs + stream tickets. Mock: random per boot if unset. Required outside mock. */
  QUIVR_JWT_SECRET: z.string().min(32).optional(),
  /** Engine cycle (ms). Spec: 15000. */
  ENGINE_CYCLE_MS: z.coerce.number().int().min(250).max(60_000).default(15_000),
  /** Optional RPC override (else public RPC for CHAIN_ID; Alchemy if ALCHEMY_API_KEY). */
  RPC_URL: z.string().url().optional(),
  /** Price source for paper + backtest. 'mainnet-readonly' = eth_call reads of verified Chainlink 4663 feeds (no signing/tx). */
  PRICE_SOURCE: z.enum(["mock", "mainnet-readonly"]).default("mock"),
  MAINNET_READONLY_RPC_URL: z.string().url().default("https://rpc.mainnet.chain.robinhood.com"),
  /** M5.0: read-only testnet 46630 adapter (eth_call/getCode/getBalance only; never signs or sends). Off by default. */
  CHAIN_READS_ENABLED: bool.default(false),
  /** M5.22: paper revenue ledger (creator share of copy/fork paper fees). Off by default; never pays anything. */
  REVENUE_ACCOUNTING_ENABLED: bool.default(false),
  /** M5.23: our own test venue on 46630 (SIGNOFF §9.1). Off unless enabled AND all three addresses are set. */
  TEST_POOL_ENABLED: bool.default(false),
  TEST_POOL_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  TEST_USDG_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  TEST_NVDA_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  TEST_POOL_RPC_URL: z.string().url().optional(),
  /** basis points of follower paper fees credited to the author (0..5000). Product decision; unset = ledger stays off. */
  CREATOR_SHARE_BPS: z.coerce.number().int().min(0).max(5000).optional(),
  // M5.15 replay video renderer: stub (default) or a local ffmpeg binary. Output stays on local disk.
  REPLAY_RENDERER: z.enum(["stub", "ffmpeg"]).default("stub"), FFMPEG_PATH: z.string().default("/usr/bin/ffmpeg").refine((p) => /^(\/|[A-Za-z]:[\\/])/.test(p) && !/(^|[\\/])\.\.([\\/]|$)/.test(p) && !/[\0\r\n]/.test(p), "absolute path to the ffmpeg binary (no ..)") /* M5.20 */, REPLAY_RENDER_DIR: z.string().default("./data/renders"),
  REPLAY_RENDER_MAX_SEC: z.coerce.number().int().min(5).max(600).default(90), REPLAY_RENDER_MAX_BYTES: z.coerce.number().int().min(100_000).max(100_000_000).default(20_000_000), REPLAY_RENDER_MAX_QUEUE: z.coerce.number().int().min(1).max(1000).default(20),
  TESTNET_RPC_URL: z.string().url().default("https://rpc.testnet.chain.robinhood.com"),
  CHAIN_READ_TIMEOUT_MS: z.coerce.number().int().min(250).max(20000).default(4000),
  /** keccak256 of the deployed SessionAccount runtime code; unset = "unchecked" (account fields still read, labelled). */
  TESTNET_SESSION_ACCOUNT_CODEHASH: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  VERIFIED_READONLY_PATH: z.string().default("config/verified/4663-readonly.json"),
  /** Optional free-tier EOD vendor key (Tiingo) for MODELED backtest history older than the on-chain feed. Unset = no modeled data. */
  TIINGO_API_KEY: opt,
  JUPITER_API_KEY: opt,
  JUPITER_PRICE_API_URL: z.string().url().default("https://api.jup.ag/price/v3"),
  /** SSE heartbeat interval and per-subscriber queue bound (backpressure). */
  SSE_HEARTBEAT_MS: z.coerce.number().int().min(1000).max(60_000).default(15_000),
  SSE_MAX_QUEUE: z.coerce.number().int().min(10).max(100_000).default(1000),
  /** Max runs ticking concurrently per engine wave (the 15s loop is spread across the cycle). */
  ENGINE_CONCURRENCY: z.coerce.number().int().min(1).max(10_000).default(64),
  /** M3.5: dev login (idToken "dev:<label>") is IMPERSONATION by design: anyone who knows a label is that user.
   *  OFF by default; enable only explicitly for local dev / a preview behind HTTP basic auth. Refused when
   *  NODE_ENV=production (any casing) and outside mock/testnet mode. */
  DEV_LOGIN_ENABLED: bool.default(false),
  NODE_ENV: z.string().optional(),
  /** M3.5: per-user caps (429 when exceeded). Active = paper/testnet/live runs not yet stopped. */
  MAX_ACTIVE_RUNS_PER_USER: z.coerce.number().int().min(1).max(1000).default(5),
  /** M3.5: concurrent run-event SSE connections per user (429 when exceeded). */
  LEADERBOARD_MIN_TRADES: z.coerce.number().int().min(0).max(1000).default(3), // M4.8 public leaderboard threshold
  MAX_SSE_PER_USER: z.coerce.number().int().min(1).max(1000).default(10),
  /** M5.10: origin named in EIP-4361 wallet-link messages (domain + URI). */
  SIWE_ORIGIN: z.string().optional().refine((o) => o === undefined || /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(o), "scheme://host[:port]"),
  /** M5.11: dev-only fallback to http://localhost:3000 when SIWE_ORIGIN is unset (ignored unless QUIVR_MODE=mock). */
  SIWE_DEV_LOCALHOST: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  CORS_ORIGINS: z.string().default("http://localhost:3000").refine((s) => s.split(",").map((x) => x.trim()).filter(Boolean).every((o) => /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(o)), "comma-separated exact origins (scheme://host[:port]); no wildcards"),
  /** Trust X-Forwarded-For for rate limiting only behind a known reverse proxy. */
  TRUST_PROXY: bool.default(false),
  /** M5.21 (B2): with TRUST_PROXY, honour X-Forwarded-For only when the TCP peer is loopback (Caddy on the same host). "any" = old behaviour. */
  TRUST_PROXY_PEERS: z.enum(["loopback", "any"]).default("loopback"),
  /** M5.21 (W1/B1): shared secret the web server sends as "X-Quiver-Internal-Token" on server-side calls; accepted only from loopback.
   *  Unset = no internal bucket (normal per-IP limits). ≥32 random chars; placeholder, Robin generates it. */
  INTERNAL_PROXY_TOKEN: z.string().min(32, "INTERNAL_PROXY_TOKEN must be at least 32 characters").max(256).optional(),
  /** M5.21 (B6): hard cap for the background price-history load after listen(). */
  WARMUP_MAX_MS: z.coerce.number().int().min(1000).max(600_000).default(30_000),
  /** M3.7: operator token for /v1/ops/* (shutdown; run list/stop in mock/testnet only). Unset = every ops route is 404.
   *  ≥32 chars, random; send as "Authorization: Bearer <OPS_TOKEN>". Placeholder: the operator (Robin) generates it. */
  OPS_TOKEN: z.string().min(32, "OPS_TOKEN must be at least 32 characters").max(256).optional(),
});

/** Mainnet = real money. Every listed key must be present or the process must exit non-zero. */
export const Config = RawConfig.superRefine((c, ctx) => {
  const mainnet = c.QUIVR_MODE === "mainnet" || c.CHAIN_ID === 4663;
  if (c.QUIVR_MODE === "testnet" && !c.QUIVR_JWT_SECRET) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["QUIVR_JWT_SECRET"], message: "required outside mock mode" });
  // M3.6: case/whitespace-insensitive NODE_ENV check, and dev login only in mock or testnet mode.
  if (c.DEV_LOGIN_ENABLED && (c.NODE_ENV ?? "").trim().toLowerCase() === "production") ctx.addIssue({ code: "custom", path: ["DEV_LOGIN_ENABLED"], message: "dev login is refused when NODE_ENV=production" });
  if (c.DEV_LOGIN_ENABLED && c.QUIVR_MODE !== "mock" && c.QUIVR_MODE !== "testnet") ctx.addIssue({ code: "custom", path: ["DEV_LOGIN_ENABLED"], message: "dev login is allowed only in mock or testnet mode" });
  // M4.6 (M3.9 audit): session-key defaults must themselves pass prepare's rules.
  if (c.SK_DEFAULT_EXPIRY_HOURS > c.SK_MAX_EXPIRY_HOURS) ctx.addIssue({ code: "custom", path: ["SK_DEFAULT_EXPIRY_HOURS"], message: "must be ≤ SK_MAX_EXPIRY_HOURS" });
  if (c.SK_DEFAULT_DAILY_USD < c.SK_DEFAULT_PER_TX_USD || c.SK_DEFAULT_DAILY_USD > 64 * c.SK_DEFAULT_PER_TX_USD) ctx.addIssue({ code: "custom", path: ["SK_DEFAULT_DAILY_USD"], message: "must be between SK_DEFAULT_PER_TX_USD and 64 × SK_DEFAULT_PER_TX_USD" });
  if (!mainnet) return;
  const need = (ok: unknown, key: string, msg = "required on mainnet") => { if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: msg }); };
  need(c.QUIVR_MAINNET_ENABLED, "QUIVR_MAINNET_ENABLED", "must be true to run on chain 4663");
  need(c.CHAIN_ID === 4663, "CHAIN_ID", "mainnet mode requires 4663");
  need(c.QUIVR_TREASURY, "QUIVR_TREASURY");
  need(c.QUIVR_FEE_ROUTER ?? c.QUIVR_TREASURY, "QUIVR_FEE_ROUTER");
  need(c.ALCHEMY_API_KEY, "ALCHEMY_API_KEY");
  need(c.SIGNER_BACKEND !== "local_dev", "SIGNER_BACKEND", "local_dev signer is refused on mainnet");
  need(c.SIGNER_BACKEND !== "kms" || c.KMS_KEY_RING, "KMS_KEY_RING");
  need(c.OPENROUTER_API_KEY, "OPENROUTER_API_KEY");
  need(c.DATABASE_URL, "DATABASE_URL");
  need(c.REDIS_URL, "REDIS_URL");
  need(c.PRIVY_APP_ID && c.PRIVY_APP_SECRET, "PRIVY_APP_ID");
  need(c.GEO_IP_DB_PATH, "GEO_IP_DB_PATH");
  need(!c.TERMS_VERSION.startsWith("draft-"), "TERMS_VERSION", "draft terms are refused on mainnet");
  need(c.QUIVR_JWT_SECRET, "QUIVR_JWT_SECRET");
  need(!c.DEV_LOGIN_ENABLED, "DEV_LOGIN_ENABLED", "dev login is refused on mainnet");
  need(!c.GAS_SPONSORSHIP_ENABLED || c.ALCHEMY_GAS_POLICY_ID, "ALCHEMY_GAS_POLICY_ID");
  // Verified-address registry (config/verified/4663.json, §10) is checked at boot by the loader, not here.
});
export type Config = z.infer<typeof Config>;
