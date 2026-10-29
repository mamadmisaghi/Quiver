// Request/response bodies for every REST endpoint. Base URL: /v1. Auth: `Authorization: Bearer <access JWT>`.
import { z } from "zod";
import { BacktestId, CompileId, Decimal, EquityUsd, EvmAddress, IsoTime, Page, PageQuery, RunId, RunMode, SessionKeyId, StrategyId, TxHash, UserId, Venue, WarmupNotice } from "./common";
import { Humanized, Instrument, InstrumentId, Strategy, ValidationIssue } from "./strategy";
import { RunEvent, TriggerStateItem } from "./events";

// ---------- Auth ----------
/** Privy-style login happens client-side; the backend exchanges the provider token for our session. */
export const AuthExchangeReq = z.object({ provider: z.literal("privy"), idToken: z.string().min(20) });
export const Eligibility = z.object({
  country: z.string().length(2).nullable(), // ISO-3166 from server-side IP geo, never client-declared alone
  selfDeclaredNonUsPerson: z.boolean(),
  stockTokens: z.enum(["allowed", "blocked", "unknown"]),
  reason: z.string().nullable(),
});
export const Me = z.object({
  id: UserId, createdAt: IsoTime, displayName: z.string().nullable(),
  wallets: z.array(z.object({ chain: z.enum(["robinhood", "solana", "hyperliquid"]), address: z.string(), kind: z.enum(["embedded", "external", "smart_account"]) })),
  eligibility: Eligibility,
  enabledModes: z.array(RunMode), // ["paper"] until testnet/live are approved and enabled
  quotas: z.object({ compilesPerDay: z.number().int(), compilesUsedToday: z.number().int() }),
});
export const AuthExchangeRes = z.object({ accessToken: z.string(), expiresAt: IsoTime, me: Me }); // refresh via httpOnly cookie
export const EligibilityDeclareReq = z.object({ nonUsPerson: z.literal(true), countryOfResidence: z.string().length(2), acceptedTermsVersion: z.string() });

// ---------- Strategies ----------
export const StrategyRecord = z.object({
  id: StrategyId, ownerId: UserId, name: z.string(), version: z.number().int().min(1),
  status: z.enum(["draft", "valid", "invalid", "archived"]),
  strategy: Strategy, humanized: Humanized, issues: z.array(ValidationIssue),
  venues: z.array(Venue), createdAt: IsoTime, updatedAt: IsoTime,
  activeRunId: RunId.nullable(),
  // v1.1: canvas node titles (same shape as compile partial.node), publish state
  nodes: z.array(z.object({ id: z.string(), kind: z.enum(["watch", "when", "do", "exit"]), title: z.string(), detail: z.string(), venue: Venue.optional() })).default([]),
  public: z.boolean().default(false), forkedFrom: StrategyId.nullable().default(null),
});
export const StrategySummary = StrategyRecord.pick({ id: true, name: true, version: true, status: true, venues: true, updatedAt: true, activeRunId: true });
export const ListStrategiesQuery = PageQuery.extend({ status: z.enum(["draft", "valid", "invalid", "archived"]).optional() });
export const ListStrategiesRes = Page(StrategySummary);
export const CreateStrategyReq = z.object({ strategy: Strategy, compileId: CompileId.optional() });
export const UpdateStrategyReq = z.object({ strategy: Strategy, expectedVersion: z.number().int() }); // optimistic concurrency -> 409 conflict

// ---------- Compile (NL -> strategy) ----------
export const CompileReq = z.object({
  thesis: z.string().min(8).max(2000),
  baseStrategy: Strategy.optional(), // present => refine
  instruction: z.string().max(500).optional(), // refine chip text, e.g. "Add a weekend-only filter"
  images: z.array(z.object({ mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]), dataBase64: z.string().max(2_800_000) })).max(2).optional(),
});
// Response: application/x-ndjson stream of CompileEvent (see events.ts)

// ---------- Validate ----------
export const ValidateReq = z.object({ strategy: z.unknown() }); // raw; server runs zod + semantic checks
export const ValidateRes = z.object({ ok: z.boolean(), strategy: Strategy.nullable(), humanized: Humanized.nullable(), issues: z.array(ValidationIssue) });

// ---------- Backtest ----------
export const BacktestReq = z.object({
  strategyId: StrategyId.optional(), strategy: Strategy.optional(), // one of
  from: IsoTime, to: IsoTime, // max 365 days in v1
  resolution: z.enum(["1m", "5m", "15m", "1h", "1d"]).default("15m"),
  startingEquityUsd: EquityUsd.default("10000"),
  feeModel: z.enum(["default", "zero"]).default("default"),
});
export const BacktestStatus = z.enum(["queued", "running", "done", "failed", "canceled"]);
export const BacktestRes = z.object({
  id: BacktestId, status: BacktestStatus, progress: z.number().min(0).max(1),
  /** M5.18: "tiingo" when stock/ETF bars came from Tiingo; "fallback" = the current source. */
  dataSource: z.enum(["tiingo", "fallback"]),
  dataCoverage: z.array(z.object({ instrument: InstrumentId, source: z.string(), from: IsoTime, to: IsoTime, gaps: z.number().int(), synthetic: z.boolean() })),
  result: z.object({
    endingEquityUsd: Decimal, returnPct: Decimal, maxDrawdownPct: Decimal, sharpe: Decimal.nullable(), trades: z.number().int(), winRatePct: Decimal.nullable(), feesUsd: Decimal,
    equityCurve: z.array(z.tuple([IsoTime, Decimal])), // downsampled to <= 500 points
    fills: z.array(z.object({ ts: IsoTime, actionId: z.string(), instrument: InstrumentId, side: z.string(), qty: Decimal, price: Decimal, feeUsd: Decimal })),
    triggerFires: z.array(z.object({ ts: IsoTime, triggerId: z.string() })),
    caveats: z.array(z.string()), // always includes "Past results are not a promise of future returns."
    // v1.1: same points as equityCurve plus pnl and drawdown
    equitySeries: z.array(z.object({ ts: IsoTime, equityUsd: Decimal, pnlUsd: Decimal, drawdownPct: Decimal })).default([]),
    // v1.2 (M3): extra metrics + cost breakdown (optional for older clients)
    stats: z.object({ sortino: Decimal.nullable(), volatilityAnnPct: Decimal.nullable(), maxDrawdownDurationHours: Decimal, closedTrades: z.number().int(),
      profitFactor: Decimal.nullable(), avgWinUsd: Decimal.nullable(), avgLossUsd: Decimal.nullable(), conventions: z.string() }).optional(),
    costs: z.object({ feesUsd: Decimal, gasUsd: Decimal, spreadUsd: Decimal, impactUsd: Decimal }).optional(),
  }).nullable(),
  error: z.string().nullable(),
  /** M5.22: true if the run finished while the server was warming up (bars may be partial). */
  warmup: z.boolean().default(false),
  warmupNotice: WarmupNotice.nullable().default(null),
});

// ---------- Runs (paper / testnet / live) ----------
export const StartRunReq = z.object({
  strategyId: StrategyId, version: z.number().int().optional(), mode: RunMode,
  paper: z.object({ startingEquityUsd: EquityUsd.default("10000") }).optional(),
  sessionKeyId: SessionKeyId.optional(), // required for testnet/live on EVM venues
  /** M4.2: confirm_each = approval-required mode. Each NEW opening order waits as a pending Approval; closes/exits never wait. */
  approvalMode: z.enum(["auto", "confirm_each"]).default("auto"),
  /** M4.2: how long a proposal waits before it expires (s). */
  approvalTtlSec: z.number().int().min(30).max(3600).default(300),
});
export const Run = z.object({
  id: RunId, strategyId: StrategyId, strategyVersion: z.number().int(), mode: RunMode,
  status: z.enum(["starting", "running", "paused", "stopped", "halted"]),
  startedAt: IsoTime, stoppedAt: IsoTime.nullable(), lastSeq: z.number().int(),
  equityUsd: Decimal, pnlUsd: Decimal, pnlPct: Decimal,
  approvalMode: z.enum(["auto", "confirm_each"]).default("auto"), pendingApprovals: z.number().int().default(0), // M4.2
  triggerStates: z.array(TriggerStateItem).default([]), // M4.7: live runs only; [] once stopped
  /** M5.10: fills that resolved after a timed-out stop_and_flatten and were refused (never applied). */
  blockedFills: z.number().int().default(0),
});
export const RunControlReq = z.object({ action: z.enum(["pause", "resume", "stop", "stop_and_flatten"]) });

// ---------- Session keys (trade-only) ----------
export const SessionKeyPolicy = z.object({
  chainId: z.literal(4663).or(z.literal(46630)),
  allowedTargets: z.array(z.object({ address: EvmAddress, label: z.string(), selectors: z.array(z.string().regex(/^0x[0-9a-f]{8}$/)).min(1) })).min(1),
  allowedTokens: z.array(EvmAddress).min(1),
  recipientMustBe: z.literal("self"), // swap output recipient == the smart account
  perTxCapUsd: Decimal, dailyCapUsd: Decimal,
  expiresAt: IsoTime, // max 30 days in v1
  nativeTransfer: z.literal(false), erc20Transfer: z.literal(false), approveOnlyTargets: z.literal(true),
  /** M3.6.1: max swap slippage in percent, from the SessionAccount's on-chain slippage cap (slippageCapBps / 100). 1 when unset; owner may raise up to 10. */
  maxSlippagePct: z.number().gt(0).max(10),
  /** M3.9: same value in basis points, exactly as passed to SessionAccount.grant(maxSlippageBps). */
  maxSlippageBps: z.number().int().min(1).max(1000),
});
/** M3.6.1: default caps (same numbers as SIGNOFF M3.6). minSwapUsd = ceil(dailyCapUsd / 64, cents). */
export const SessionKeyDefaults = z.object({ perTradeCapUsd: z.number().positive(), dailyCapUsd: z.number().positive(), minSwapUsd: z.number().positive(), maxSlippagePct: z.number().gt(0).max(10),
  /** M3.9 */ defaultExpiryHours: z.number().int().positive(), maxExpiryHours: z.number().int().positive(), maxDailyToPerTradeRatio: z.literal(64) });
/** M3.9: expiresInHours (default defaults.defaultExpiryHours, max defaults.maxExpiryHours) replaces expiresInDays (still accepted, ×24; not both).
 *  maxSlippagePct optional, default 1, ≤ the account cap (1 unless raised on-chain, ceiling 10), whole bps. dailyCapUsd ≤ 64 × perTxCapUsd. */
export const PrepareSessionKeyReq = z.object({ chainId: z.union([z.literal(4663), z.literal(46630)]), perTxCapUsd: Decimal, dailyCapUsd: Decimal,
  expiresInHours: z.number().int().min(1).max(720).optional(), expiresInDays: z.number().int().min(1).max(30).optional(),
  maxSlippagePct: z.number().gt(0).max(10).optional(), tokens: z.array(InstrumentId).min(1) });
const Hex32 = z.string().regex(/^0x[0-9a-f]{64}$/);
/** Exact SessionAccount.grant(...) arguments (caps in token base units, decimal strings). */
export const SessionKeyGrant = z.object({ key: EvmAddress, expiry: z.number().int(), maxSlippageBps: z.number().int().min(1).max(1000), tokens: z.array(EvmAddress).min(1), perTxCaps: z.array(z.string().regex(/^\d+$/)), windowCaps: z.array(z.string().regex(/^\d+$/)) });
export const PrepareSessionKeyRes = z.object({
  sessionKeyId: SessionKeyId, sessionKeyAddress: EvmAddress, smartAccount: EvmAddress, policy: SessionKeyPolicy, defaults: SessionKeyDefaults,
  humanReadable: z.array(z.string()), // "Can swap on Uniswap Universal Router", "Cannot transfer or withdraw"
  /** M3.9: keccak256(abi.encode(chainId, smartAccount, targetsHash, grant...)); also inside the typed data message. */
  policyHash: Hex32, grant: SessionKeyGrant,
  /** Step 1: eth_signTypedData_v4 [ownerAddress, JSON.stringify(data)] (uint64 expiresAt is a decimal string). */
  signatureRequest: z.object({ type: z.literal("eth_signTypedData_v4"), data: z.object({ domain: z.object({ name: z.string(), version: z.string(), chainId: z.number().int() }), types: z.record(z.string(), z.array(z.object({ name: z.string(), type: z.string() }))), primaryType: z.literal("SessionKeyGrant"),
    message: z.object({ sessionKey: EvmAddress, smartAccount: EvmAddress, policyHash: Hex32, expiresAt: z.string().regex(/^\d+$/), maxSlippageBps: z.number().int() }) }) }),
  /** Step 3 (testnet): EIP-5792 wallet_sendCalls request that installs the grant on the smart account. Send as-is. */
  install: z.object({ method: z.literal("wallet_sendCalls"), params: z.tuple([z.object({ version: z.literal("2.0.0"), chainId: z.string().regex(/^0x[0-9a-f]+$/), from: EvmAddress, atomicRequired: z.literal(true), calls: z.array(z.object({ to: EvmAddress, data: z.string().regex(/^0x[0-9a-f]+$/), value: z.literal("0x0") })).length(1) })]) }),
});
/** M3.9: policyHash is checked against the prepared grant (send PrepareSessionKeyRes.policyHash). installTxHash: testnet, from wallet_getCallsStatus. */
export const SubmitSessionKeyReq = z.object({ sessionKeyId: SessionKeyId, signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/), policyHash: Hex32, installTxHash: TxHash.optional() });
export const SessionKey = z.object({ id: SessionKeyId, status: z.enum(["pending", "active", "expired", "revoked"]), policy: SessionKeyPolicy, createdAt: IsoTime, spentTodayUsd: Decimal, revokeTx: TxHash.nullable(),
  /** M3.9 */ policyHash: Hex32.nullable().default(null), installTx: TxHash.nullable().default(null) });
/** Revoke: server stops using the key immediately (off-chain), and returns an owner-signed on-chain uninstall for defense in depth. */
export const RevokeSessionKeyRes = z.object({ sessionKey: SessionKey, onchainRevoke: z.object({ signatureRequest: z.unknown() }).nullable() });

// ---------- Venues, markets, quotes ----------
export const VenueInfo = z.object({ id: Venue, name: z.string(), status: z.enum(["up", "degraded", "down"]), capabilities: z.array(z.enum(["read", "paper", "testnet", "live"])), note: z.string().nullable() });
export const MarketsQuery = PageQuery.extend({ venue: Venue.optional(), q: z.string().max(40).optional(), assetClass: z.enum(["crypto", "equity", "etf", "outcome"]).optional() });
/** Where a price came from. mock_* = synthetic (mock mode); chainlink_mainnet_readonly = real on-chain read; modeled_eod_* = "Modeled" daily close; none = no price. */
export { PriceSource } from "./common";
import { PriceSource } from "./common";
/** One price observation (API view of the server PricePoint). */
export const PricePoint = z.object({ value: Decimal, observedAt: IsoTime, source: PriceSource, stale: z.boolean().default(false), staleReason: z.enum(["market_closed"]).nullable().default(null) });
export const Market = Instrument.extend({
  name: z.string(), price: Decimal.nullable(), change24hPct: Decimal.nullable(), priceSource: PriceSource, priceAt: IsoTime.nullable(),
  /** true when `price` is the last close carried while the market is closed (staleReason market_closed). */
  priceStale: z.boolean().default(false), priceStaleReason: z.enum(["market_closed"]).nullable().default(null),
  marketSession: z.enum(["open", "closed", "pre", "post", "halted", "always"]),
  geoRestricted: z.boolean(), // true for Stock Tokens when the caller is not eligible (still visible, not tradable)
  tradable: z.boolean(),
  /** M3.3 PRICE: isMock = the current price comes from a mock_* source. priceIsReal = it comes from a verified real
   *  read-only source (chainlink_mainnet_readonly, jupiter_readonly). Both false when there is no price ("none"). */
  /** M3.4: "computed" = our price now vs 24h ago; "vendor" = supplied by the price source (Jupiter priceChange24h); null = unknown. */
  change24hSource: z.enum(["computed", "vendor"]).nullable().default(null),
  isMock: z.boolean().default(false),
  priceIsReal: z.boolean().default(false),
  /** Chain the price was verified on (4663 for Chainlink on Robinhood Chain); null for mock/none and for Solana (no EVM chain id). */
  priceVerifiedChainId: z.number().int().nullable().default(null),
  /** Network of the verified price: "robinhood-4663" | "solana"; null when not verified. */
  priceVerifiedNetwork: z.enum(["robinhood-4663", "solana"]).nullable().default(null),
  /** M3.3 TOKEN ADDRESS: true when the real token address/mint is recorded as verified (with source) in the verified registry;
   *  false when only a placeholder is known; null for perps/outcomes (no token address). Independent of the price. */
  addressVerified: z.boolean().nullable().default(null),
  /** The verified address/mint (read-only reference; the instrument `id` stays a stable internal id). */
  tokenAddress: z.string().nullable().default(null),
  addressChainId: z.number().int().nullable().default(null),
  addressSource: z.string().url().nullable().default(null),
  // v1.1: compact price series for list views (last 24 × 1h, oldest first; numbers for display only)
  spark: z.array(z.number()).default([]),
});
export const QuoteReq = z.object({ instrument: InstrumentId, side: z.enum(["buy", "sell"]), notionalUsd: Decimal, slippageBps: z.number().int().min(1).max(300).default(50) });
export const QuoteRes = z.object({ instrument: InstrumentId, route: z.enum(["uniswap_api", "0x", "jupiter", "hyperliquid"]), price: Decimal, qty: Decimal, priceImpactBps: z.number(), feeUsd: Decimal, gasUsd: Decimal.nullable(), referencePrice: Decimal.nullable(), referenceSource: z.string().nullable(), expiresAt: IsoTime });

// ---------- Portfolio ----------
/** M4.1 POST /v1/runs/:id/positions/close — paper only. pct of the CURRENT qty, 0 < pct ≤ 100, max 2 decimals. */
export const ClosePositionReq = z.object({ instrument: InstrumentId, pct: z.number().gt(0).max(100).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, "max 2 decimals") });
export const ClosePositionRes = z.object({
  runId: RunId, orderId: z.string(), instrument: InstrumentId, requestedPct: z.number(), closedFully: z.boolean(),
  status: z.enum(["filled", "rejected", "error"]),
  fill: RunEvent.refine((e) => e.type === "fill", "fill event").nullable(), // the fill RunEvent (also on the run stream)
  rejection: z.object({ code: z.string(), message: z.string() }).nullable(),
  remaining: z.object({ qty: Decimal, avgEntry: Decimal }).nullable(), // null when fully closed
});
// ---------- M4.2 approvals ----------
export const ApprovalId = z.string().regex(/^apv_[0-9A-Za-z]{10,32}$/);
export const ApprovalStatus = z.enum(["pending", "approved", "rejected", "expired", "canceled"]);
export const Approval = z.object({
  id: ApprovalId, runId: RunId, orderId: z.string(), actionId: z.string(),
  /** M4.6 — actionTitle e.g. "Buy $250 of ETH", "Close TSLA" */ strategyId: StrategyId, strategyName: z.string(), actionTitle: z.string(),
  instrument: InstrumentId, venue: Venue, side: z.enum(["buy", "sell", "long", "short"]),
  notionalUsd: Decimal, // estimate at proposal time; the risk gate and price are re-checked on approve
  status: ApprovalStatus, createdAt: IsoTime, expiresAt: IsoTime, resolvedAt: IsoTime.nullable(),
  result: z.object({ status: z.enum(["filled", "rejected", "error"]), code: z.string().nullable(), message: z.string().nullable() }).nullable(), // set after approve
});
export const ApprovalsQuery = PageQuery.extend({ status: ApprovalStatus.optional(), runId: RunId.optional() });
export const ApprovalList = z.object({ items: z.array(Approval), nextCursor: z.string().nullable() });
export const DecideApprovalReq = z.object({ decision: z.enum(["approve", "reject"]) });
/** M4.6: `error.details` of the 409 when approving on a run that is not active. */
export const ApproveConflictDetails = z.object({ runStatus: z.enum(["paused", "halted", "stopped", "aborted"]), haltReason: z.string().optional() });
// ---------- M4.6 positions ----------
export const PositionsQuery = z.object({ mode: RunMode.default("paper"), runId: RunId.optional() });
export const OpenPosition = z.object({ instrument: InstrumentId, symbol: z.string(), venue: Venue, runId: RunId, strategyId: StrategyId, strategyName: z.string(), qty: Decimal, side: z.enum(["long", "short"]),
  avgEntry: Decimal, markPrice: Decimal.nullable(), unrealizedPnlUsd: Decimal.nullable(), notionalUsd: Decimal.nullable(), openedAt: IsoTime });
export const PositionsRes = z.object({ mode: RunMode, items: z.array(OpenPosition), asOf: IsoTime });
export const MAX_PENDING_APPROVALS_PER_RUN = 20;
export const PortfolioQuery = z.object({ mode: RunMode.default("paper") });
export const Position = z.object({ instrument: InstrumentId, symbol: z.string(), venue: Venue, qty: Decimal, avgEntry: Decimal, markPrice: Decimal.nullable(), valueUsd: Decimal.nullable(), unrealizedPnlUsd: Decimal.nullable(), runId: RunId.nullable() });
export const Portfolio = z.object({ mode: RunMode, equityUsd: Decimal, cashUsd: Decimal, realizedPnlUsd: Decimal, unrealizedPnlUsd: Decimal, positions: z.array(Position), asOf: IsoTime });
// ---------- M4.3 portfolio views (across ALL of the user's runs in a mode, stopped runs included) ----------
export const PortfolioRunsQuery = z.object({ mode: RunMode.default("paper"), status: z.enum(["active", "stopped", "all"]).default("all") });
const PnlBlock = { startingEquityUsd: Decimal, equityUsd: Decimal, pnlUsd: Decimal, pnlPct: Decimal, realizedPnlUsd: Decimal, unrealizedPnlUsd: Decimal, feesUsd: Decimal, openPositions: z.number().int(), fills: z.number().int() };
export const PortfolioRunRow = z.object({ runId: RunId, strategyId: StrategyId, status: z.enum(["starting", "running", "paused", "stopped", "halted"]), startedAt: IsoTime, stoppedAt: IsoTime.nullable(), ...PnlBlock });
export const PortfolioRuns = z.object({ mode: RunMode, items: z.array(PortfolioRunRow), totals: z.object(PnlBlock), asOf: IsoTime });
export const AllocationBy = z.enum(["venue", "asset_class", "instrument"]);
export const PortfolioAllocationQuery = z.object({ mode: RunMode.default("paper"), by: AllocationBy.default("venue") });
export const AllocationItem = z.object({ key: z.string(), label: z.string(), longUsd: Decimal, shortUsd: Decimal, grossUsd: Decimal, netUsd: Decimal, weightPct: Decimal, positions: z.number().int() });
/** weightPct = grossUsd / grossExposureUsd × 100 (2 dp). Items sorted grossUsd desc, then key. Open positions only (active runs). */
export const PortfolioAllocation = z.object({ mode: RunMode, by: AllocationBy, grossExposureUsd: Decimal, netExposureUsd: Decimal, cashUsd: Decimal, items: z.array(AllocationItem), asOf: IsoTime });
export const PortfolioHistoryQuery = z.object({ mode: RunMode.default("paper"), points: z.coerce.number().int().min(2).max(500).default(200) });
/** Combined equity: at each ts, sum of each started run's last-known equity; pnlUsd vs the sum of those runs' starting equity. */
export const PortfolioHistory = z.object({ mode: RunMode, points: z.array(z.object({ ts: IsoTime, equityUsd: Decimal, pnlUsd: Decimal, activeRuns: z.number().int() })), asOf: IsoTime });
// ---------- M4.4 run replay ("films") ----------
export const ReplayQuery = z.object({ frameMs: z.coerce.number().int().min(1000).max(86_400_000).default(60_000), maxFrames: z.coerce.number().int().min(1).max(2000).default(500), from: IsoTime.optional(), to: IsoTime.optional() });
export const ReplayFrame = z.object({ i: z.number().int(), ts: IsoTime, lastSeq: z.number().int(), equityUsd: Decimal.nullable(),
  positions: z.array(z.object({ instrument: InstrumentId, qty: Decimal, avgEntry: Decimal })), events: z.array(z.object({ seq: z.number().int(), ts: IsoTime, type: z.string(), summary: z.string() })),
  counts: z.object({ fills: z.number().int(), rejected: z.number().int(), halts: z.number().int() }) });
export const Replay = z.object({ runId: RunId, frameMs: z.number().int(), startTs: IsoTime, endTs: IsoTime, totalFrames: z.number().int(), truncated: z.boolean(), frames: z.array(ReplayFrame),
  chapters: z.array(z.object({ frame: z.number().int(), seq: z.number().int(), type: z.string(), summary: z.string() })), digest: z.string().regex(/^sha256:[0-9a-f]{64}$/) });
export const FillsQuery = PageQuery.extend({ runId: RunId.optional(), mode: RunMode.optional() });

/** M5.6: compile from a chart screenshot (signed-in only). Response is the same NDJSON stream as /compile. */
export const CompileImageReq = z.object({
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  imageBase64: z.string().min(16).max(3_000_000), // decoded must be ≤ 2 MB (413 payload_too_large past that); a data: URL prefix is accepted
  note: z.string().max(500).optional(), // optional hint, e.g. "SOL perp, long the breakout, $200"
});
