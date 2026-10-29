import type { z } from "zod";
import type { BacktestRes } from "../../contracts/src/api";
import type { Strategy } from "../../contracts/src/strategy";
import { iso } from "../lib/clock";
import { dec, usd } from "../lib/dec";
import { Executor } from "../sim/executor";
import { computeMetrics } from "./metrics";
import type { Adapters } from "../venues/adapters";
import type { MarketData } from "../venues/market";
import type { Registry } from "../venues/registry";

export const RES_MS = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "1d": 86_400_000 } as const;
export const MAX_BARS = 150_000;
export const MAX_RANGE_MS = 365 * 86_400_000;
/** M3.5: earliest allowed backtest `from` = UTC midnight of (now − 365 days). v1 history window. */
export const BACKTEST_HISTORY_MS = MAX_RANGE_MS;
export const earliestFrom = (now: number) => Math.floor((now - BACKTEST_HISTORY_MS) / 86_400_000) * 86_400_000;
type Result = NonNullable<z.infer<typeof BacktestRes>["result"]>;
type Coverage = z.infer<typeof BacktestRes>["dataCoverage"];

export interface BacktestInput { strategy: Strategy; from: number; to: number; resolution: keyof typeof RES_MS; startingEquity: number; feeModel: "default" | "zero" }
export class BacktestError extends Error { constructor(public code: "backtest_data_unavailable" | "validation_failed", msg: string) { super(msg); } }

export function checkRange(i: Pick<BacktestInput, "from" | "to" | "resolution">) {
  if (!(i.to > i.from)) throw new BacktestError("validation_failed", "`to` must be after `from`.");
  if (i.to - i.from > MAX_RANGE_MS) throw new BacktestError("validation_failed", "Backtests are limited to 365 days in v1.");
  if (Math.floor(i.to / RES_MS[i.resolution]) * RES_MS[i.resolution] < Math.ceil(i.from / RES_MS[i.resolution]) * RES_MS[i.resolution] + RES_MS[i.resolution])
    throw new BacktestError("validation_failed", "The range must cover at least one full bar at this resolution.");
  if ((i.to - i.from) / RES_MS[i.resolution] > MAX_BARS) throw new BacktestError("validation_failed", `Too many bars (> ${MAX_BARS}); use a coarser resolution.`);
}

/**
 * Same engine + executor as live paper runs. Decision at each bar close (t = boundary − 1 ms, so no
 * look-ahead); orders fill at the NEXT bar's open (t = boundary) with the √(notional/depth) impact model.
 */
export async function runBacktest(i: BacktestInput, deps: { mkt: MarketData; adapters: Adapters; registry: Registry; stockTokensAllowed: boolean },
  hooks: { progress?: (p: number) => void; canceled?: () => boolean; yield?: () => Promise<void> } = {}): Promise<{ result: Result; coverage: Coverage } | null> {
  checkRange(i);
  const tf = RES_MS[i.resolution];
  const ex = new Executor({ strategy: i.strategy, mkt: deps.mkt, adapters: deps.adapters, registry: deps.registry, startingEquity: i.startingEquity,
    stockTokensAllowed: () => deps.stockTokensAllowed, killSwitch: () => false, fillModel: "next_bar", feeModel: i.feeModel, emit: () => {}, stockNextOpen: i.resolution === "1d" });
  const curve: [number, number][] = [];
  const start = Math.ceil(i.from / tf) * tf; const total = Math.max(1, Math.floor((i.to - start) / tf));
  let k = 0;
  for (let T = start + tf; T <= i.to; T += tf, k++) {
    ex.settleAtOpen(T - 1); // M5.19: queued daily stock orders fill at the open before this bar's close is evaluated
    await ex.cycle(T - 1, { emitTick: false });
    ex.settlePending(T);
    curve.push([T, ex.equity(T)]);
    if (k % 500 === 0) { hooks.progress?.(k / total); if (hooks.canceled?.()) return null; await (hooks.yield?.() ?? new Promise<void>((r) => setImmediate(r))); }
  }
  hooks.progress?.(1);
  const end = curve.at(-1)?.[1] ?? i.startingEquity;
  const closes = ex.fills.filter((f) => f.reducing);
  const mx = computeMetrics(curve, i.startingEquity, closes.map((f) => f.realized - f.feeUsd));
  const step = Math.max(1, Math.ceil(curve.length / 500));
  const sampled = curve.filter((_, j) => j % step === 0 || j === curve.length - 1);
  const instruments = new Set<string>(); i.strategy.signals.forEach((s) => "instrument" in s.params && instruments.add(s.params.instrument)); i.strategy.actions.forEach((a) => instruments.add(a.instrument));
  const cov = [...instruments].flatMap((id) => (deps.mkt.coverage?.(id, i.from, i.to) ?? [{ source: deps.mkt.synthetic ? "mock_synthetic" : "vendor", from: i.from, to: i.to, gaps: 0, synthetic: deps.mkt.synthetic, modeled: false }])
    .map((c) => ({ ...c, instrument: id })));
  const hasStock = [...instruments].some((id) => { const m = deps.registry.get(id); return m?.venue === "robinhood" && (m.assetClass === "equity" || m.assetClass === "etf"); });
  const realSources = cov.some((c) => !c.synthetic && c.source !== "none");
  const noData = [...new Set(cov.filter((c) => c.source === "none").map((c) => deps.registry.get(c.instrument)?.symbol ?? c.instrument))];
  const caveats = [
    "Past results are not a promise of future returns.",
    !realSources ? "Prices are SYNTHETIC (mock mode) — this backtest shows how the rules behave, not how they would have performed."
      : !cov.some((c) => !c.synthetic && c.source !== "none" && !c.source.startsWith("tiingo")) ? "Instruments without Tiingo history use synthetic prices. Each instrument's data source is listed in dataCoverage."
      : "Robinhood Stock Token and ETH/BTC prices are Chainlink mainnet feed rounds (read-only); other venues are synthetic. Each instrument's data source is listed in dataCoverage.",
    ...(noData.length ? [`No price data for ${noData.join(", ")} in this window, so signals and orders on it could not run.`] : []),
    ...(ex.fills.length === 0 ? ["No trades: the entry conditions were never met in this window."] : []),
    ...(i.resolution === "1d" && hasStock ? ["Daily bars: Stock/ETF orders are decided on the bar's close and fill at the next session's open (skipping weekends and holidays) with modeled slippage."] : []),
    ...(ex.awaitingOpen.length ? [`${ex.awaitingOpen.length} order(s) decided near the end of the range were still waiting for the next open and were not filled.`] : []),
    ...(cov.some((c) => c.source.startsWith("tiingo")) ? ["Stock/ETF bars come from Tiingo (the underlying stock's adjusted history, not the token)."] : []),
    ...(cov.some((c) => c.modeled) ? ["Some history is MODELED from end-of-day prices of the underlying stock (not the token); see dataCoverage."] : []),
    ...(cov.some((c) => c.gaps > 0) ? ["Some price history is missing (see gaps in dataCoverage); prices are carried forward across gaps."] : []),
    "Fills are simulated at the next bar's open plus modeled costs: half-spread (wider in pre/post-market), price impact k·√(notional/depth), venue fee and gas. Real costs can be higher.",
    ...(i.resolution === "1d" && hasStock ? [] : ["Stock Token orders are not placed while the US market is closed (nights, weekends, NYSE holidays)."]),
    "Funding payments on perps and gas costs are not charged in v1 backtests.",
  ];
  if (i.strategy.risk.tradingHours) caveats.push("Trading-hours filter applied in the given time zone; exchange holidays are not modeled.");
  return {
    coverage: cov.map((c) => ({ instrument: c.instrument, source: c.source, from: iso(c.from), to: iso(c.to), gaps: c.gaps, synthetic: c.synthetic })),
    result: {
      endingEquityUsd: usd(end), returnPct: dec(mx.returnPct, 2), maxDrawdownPct: dec(mx.maxDrawdownPct, 2),
      sharpe: mx.sharpe == null ? null : dec(mx.sharpe, 2), trades: ex.fills.length, winRatePct: mx.winRatePct == null ? null : dec(mx.winRatePct, 1),
      stats: { sortino: mx.sortino == null ? null : dec(mx.sortino, 2), volatilityAnnPct: mx.volatilityAnnPct == null ? null : dec(mx.volatilityAnnPct, 2), maxDrawdownDurationHours: dec(mx.maxDrawdownDurationMs / 3_600_000, 1),
        closedTrades: mx.closedTrades, profitFactor: mx.profitFactor == null ? null : dec(mx.profitFactor, 2), avgWinUsd: mx.avgWinUsd == null ? null : usd(mx.avgWinUsd), avgLossUsd: mx.avgLossUsd == null ? null : usd(mx.avgLossUsd),
        conventions: "Sharpe/Sortino: per-bar simple returns, risk-free 0, sample stdev, annualized over 365 days. Win rate and profit factor over closed trades, net of the closing fee." },
      costs: { feesUsd: usd(ex.acct.fees - ex.costs.gasUsd), gasUsd: usd(ex.costs.gasUsd), spreadUsd: usd(ex.costs.spreadUsd), impactUsd: usd(ex.costs.impactUsd) },
      feesUsd: usd(ex.acct.fees), equityCurve: sampled.map(([t, e]) => [iso(t), usd(e)]),
      fills: ex.fills.map((f) => ({ ts: iso(f.ts), actionId: f.actionId, instrument: f.instrument, side: f.side, qty: dec(f.qty, 8), price: dec(f.price, 6), feeUsd: usd(f.feeUsd) })),
      triggerFires: ex.fires.map((f) => ({ ts: iso(f.ts), triggerId: f.triggerId })), caveats,
      equitySeries: equitySeries(sampled, i.startingEquity),
    },
  };
}

/** EquityPoint[] from [ms, equity] pairs: pnl vs start, drawdown vs running peak (percent, >= 0). */
export function equitySeries(curve: [number, number][], start: number) {
  let peak = start;
  return curve.map(([t, e]) => { peak = Math.max(peak, e); return { ts: iso(t), equityUsd: usd(e), pnlUsd: usd(e - start), drawdownPct: dec(peak > 0 ? ((peak - e) / peak) * 100 : 0, 2) }; });
}
