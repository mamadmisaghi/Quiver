// Quiver API contracts — shared primitives. Types only; no runtime logic beyond zod schemas.
import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

/** Decimal values travel as strings to avoid float loss (USD, token amounts, prices). */
export const Decimal = z.string().regex(/^-?\d+(\.\d+)?$/, "decimal string");
export type Decimal = z.infer<typeof Decimal>;
/** M3.5: starting equity for backtests / paper runs: a plain decimal in [100, 10,000,000] USD. */
export const EQUITY_MIN_USD = 100, EQUITY_MAX_USD = 10_000_000;
export const EquityUsd = Decimal.refine((v) => { const n = Number(v); return Number.isFinite(n) && n >= EQUITY_MIN_USD && n <= EQUITY_MAX_USD; }, `must be between ${EQUITY_MIN_USD} and ${EQUITY_MAX_USD} USD`);

export const IsoTime = z.string().datetime({ offset: true });
export const Id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9A-Za-z]{10,32}$`));

export const UserId = Id("usr");
export const StrategyId = Id("stg");
export const RunId = Id("run"); // a paper / testnet / live deployment of a strategy version
export const BacktestId = Id("bkt");
export const CompileId = Id("cmp");
export const SessionKeyId = Id("sk");
export const OrderId = Id("ord");
export const FillId = Id("fil");

export const EvmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const TxHash = z.string().regex(/^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{64,88})$/); // EVM or Solana sig

export const Venue = z.enum(["robinhood", "solana", "hyperliquid", "polymarket"]); // matches web/lib/mock.ts
export type Venue = z.infer<typeof Venue>;

export const RunMode = z.enum(["paper", "testnet", "live"]);
export type RunMode = z.infer<typeof RunMode>;

/** Cursor pagination: opaque cursor, newest first unless stated. */
export const PageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const Page = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

/** Provenance of a price (and of price-derived signals). */
export const PriceSource = z.enum(["mock", "mock_chainlink", "mock_pool", "mock_hyperliquid", "mock_polymarket", "mock_jupiter", "chainlink_mainnet_readonly", "modeled_eod_tiingo", "jupiter_readonly", "none"]);
export type PriceSource = z.infer<typeof PriceSource>;
/** M3.2: SignalValue.source = a PriceSource for price/odds/funding/indicator signals, or a non-price origin. */
export const SignalSource = z.enum([...PriceSource.options, "calendar", "timer", "portfolio"]);
export type SignalSource = z.infer<typeof SignalSource>;

/** M5.22: machine-readable warmup notice (history, backtest, /health). Branch on `code`, never on `message`. */
export const WarmupNotice = z.object({ code: z.literal("warming_up"), message: z.string() });
export type WarmupNotice = z.infer<typeof WarmupNotice>;
