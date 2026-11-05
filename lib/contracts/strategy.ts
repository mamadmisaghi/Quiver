// Strategy schema v1 — the ONLY thing the LLM may output and the ONLY thing the rule engine executes.
// Modeled on the mechanics of weft.fi's public schema (signals/triggers/actions/risk); our own design.
import { z } from "zod";
import { Workflow } from "./workflow";
import { Decimal, SCHEMA_VERSION, Venue } from "./common";

const LocalId = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/); // e.g. "nvda_px", "t1"

/** Instrument ids: robinhood:token:<addr> | sol:token:<mint> | hl:perp:[dex:]SYM | hl:spot:SYM | pm:outcome:<market>:YES|NO */
export const InstrumentId = z.string().regex(
  /^(robinhood:token:0x[0-9a-fA-F]{40}|sol:token:[1-9A-HJ-NP-Za-km-z]{32,44}|hl:(perp|spot):([a-z0-9]+:)?[A-Z0-9]{1,20}|pm:outcome:[A-Za-z0-9-]{1,80}:(YES|NO))$/,
);
export const Instrument = z.object({
  id: InstrumentId,
  venue: Venue,
  kind: z.enum(["token", "perp", "spot", "outcome"]),
  symbol: z.string().max(20), // display only, e.g. "NVDA"
  assetClass: z.enum(["crypto", "equity", "etf", "outcome"]),
});
export type Instrument = z.infer<typeof Instrument>;

// ---------- Signals (MVP kinds; more are added by bumping schemaVersion) ----------
const SignalBase = { id: LocalId, maxAgeSeconds: z.number().int().min(5).max(86_400).default(120) };
export const Signal = z.discriminatedUnion("kind", [
  z.object({ ...SignalBase, kind: z.literal("price"), params: z.object({ instrument: InstrumentId, source: z.enum(["chainlink_stream", "chainlink_feed", "venue_mid"]).default("venue_mid") }) }),
  z.object({ ...SignalBase, kind: z.literal("indicator"), params: z.object({ instrument: InstrumentId, name: z.enum(["sma", "ema", "rsi", "atr", "bb_upper", "bb_lower", "pct_change"]), period: z.number().int().min(2).max(500), timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]) }) }),
  z.object({ ...SignalBase, kind: z.literal("funding"), params: z.object({ instrument: InstrumentId }) }), // hl:perp only
  z.object({ ...SignalBase, kind: z.literal("odds"), params: z.object({ instrument: InstrumentId }) }), // pm:outcome, read-only
  z.object({ ...SignalBase, kind: z.literal("market_session"), params: z.object({ exchange: z.literal("XNYS") }) }), // open|closed|pre|post|halted
  z.object({ ...SignalBase, kind: z.literal("timer"), params: z.object({ cron: z.string().max(64), tz: z.string().max(64) }) }),
  z.object({ ...SignalBase, kind: z.literal("position"), params: z.object({ instrument: InstrumentId }) }), // own position size / pnl
]);
export type Signal = z.infer<typeof Signal>;

// ---------- Expression tree ----------
export const Ref = z.object({ ref: z.string().regex(/^[a-z][a-z0-9_]{0,31}\.[a-z_]{1,32}$/) }); // "nvda_px.value"
export const Lit = z.object({ lit: z.union([z.number(), z.string().max(32), z.boolean()]) });
const Operand = z.union([Ref, Lit]);
export type Expr =
  | { op: "and" | "or"; args: Expr[] }
  | { op: "not"; arg: Expr }
  | { op: "lt" | "lte" | "gt" | "gte" | "eq" | "neq" | "crosses_above" | "crosses_below"; left: z.infer<typeof Operand>; right: z.infer<typeof Operand> }
  | { op: "between"; value: z.infer<typeof Operand>; low: z.infer<typeof Operand>; high: z.infer<typeof Operand> };
export const Expr: z.ZodType<Expr> = z.lazy(() =>
  z.union([
    z.object({ op: z.enum(["and", "or"]), args: z.array(Expr).min(2).max(8) }),
    z.object({ op: z.literal("not"), arg: Expr }),
    z.object({ op: z.enum(["lt", "lte", "gt", "gte", "eq", "neq", "crosses_above", "crosses_below"]), left: Operand, right: Operand }),
    z.object({ op: z.literal("between"), value: Operand, low: Operand, high: Operand }),
  ]),
);

export const Trigger = z.object({
  id: LocalId,
  when: Expr,
  forMinutes: z.number().min(0).max(10_080).default(0), // must hold continuously
  cooldownMinutes: z.number().min(0).max(43_200).default(60),
  maxFires: z.number().int().min(1).max(1000).nullable().default(1), // null = unlimited (still bounded by risk caps)
});
export type Trigger = z.infer<typeof Trigger>;

// ---------- Actions & exits ----------
export const Size = z.object({ unit: z.enum(["usd", "pct_equity", "native"]), value: Decimal });
export const Exits = z.object({
  takeProfit: z.object({ unit: z.enum(["pct", "price"]), value: Decimal }).optional(),
  stopLoss: z.object({ unit: z.enum(["pct", "price"]), value: Decimal }).optional(),
  takeProfits: z.array(z.object({ atPct: Decimal, sellFraction: Decimal })).max(8).optional(),
  trailingStopPct: Decimal.optional(),
  timeExitHours: z.number().min(1).max(8760).optional(),
}).strict();

export const Action = z.object({
  id: LocalId,
  type: z.enum(["open", "close"]),
  on: z.array(LocalId).min(1).max(8), // trigger ids
  instrument: InstrumentId,
  side: z.enum(["buy", "sell", "long", "short"]),
  size: Size,
  leverage: z.number().min(1).max(10).default(1), // perps only; hard platform max 10x in v1
  order: z.object({
    type: z.enum(["market", "limit"]).default("market"),
    limitPrice: Decimal.optional(),
    maxSlippageBps: z.number().int().min(1).max(300).default(50),
    maxPriceImpactBps: z.number().int().min(1).max(500).default(100),
  }),
  exits: Exits.optional(),
});
export type Action = z.infer<typeof Action>;

export const Risk = z.object({
  maxPositionPct: z.number().min(1).max(100).default(25),
  maxTotalExposurePct: z.number().min(1).max(100).default(100),
  maxDailyLossPct: z.number().min(1).max(100).default(10), // breach => risk_halt
  maxOrdersPerDay: z.number().int().min(1).max(500).default(20),
  tradingHours: z.object({ from: z.string().regex(/^\d{2}:\d{2}$/), to: z.string().regex(/^\d{2}:\d{2}$/), tz: z.string(), days: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).min(1) }).optional(),
  /** Stocks: when the reference market is closed, Chainlink Data Feeds are 24/5 and pause on corporate actions. */
  equityWhenFeedStale: z.enum(["skip", "use_pool_twap"]).default("skip"),
}).strict();

export const Strategy = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  name: z.string().min(1).max(80),
  thesis: z.string().max(2000), // original natural-language text, display only, never executed
  signals: z.array(Signal).max(24),
  triggers: z.array(Trigger).max(24),
  actions: z.array(Action).max(32),
  risk: Risk,
  workflow: Workflow.optional(),
}).strict().superRefine((s, ctx) => {
  if (!s.workflow) for (const key of ["signals", "triggers", "actions"] as const) {
    if (!s[key].length) ctx.addIssue({ code: "too_small", origin: "array", minimum: 1, inclusive: true, path: [key] });
  }
});
export type Strategy = z.infer<typeof Strategy>;

/** Semantic validation output (refs resolve, venues allowed, geo, caps). Produced by POST /strategies/validate. */
export const ValidationIssue = z.object({
  path: z.string(), // JSON pointer, e.g. "/actions/0/instrument"
  code: z.enum(["schema", "unknown_ref", "unknown_trigger", "unsupported_instrument", "venue_read_only", "geo_restricted", "risk_cap", "stale_feed_unhandled", "leverage_not_allowed", "cycle", "strategy_needs_rule", "strategy_needs_action", "too_few", "too_many", "too_short", "too_long", "out_of_range", "missing_field", "invalid_value", "invalid_format", "unknown_field"]),
  severity: z.enum(["error", "warning"]),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

/** Human-readable card (Watch / When / Do / Exit) generated server-side and deterministically from the strategy. */
export const Humanized = z.object({
  watch: z.array(z.string()), when: z.array(z.string()), do: z.array(z.string()), exit: z.array(z.string()),
});
