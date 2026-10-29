import type { Strategy } from "../../contracts/src/strategy";

export type RejectCode = "kill_switch" | "geo_restricted" | "market_closed" | "outside_trading_hours" | "max_orders_per_day" | "max_position" | "max_total_exposure" | "insufficient_funds" | "session_key_cap" | "slippage_exceeded" | "price_impact_exceeded" | "quote_vs_oracle" | "no_position" | "venue_read_only" | "quote_unavailable" | "venue_unavailable" | "run_halted" | "run_paused";
export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export function inTradingHours(r: Strategy["risk"], t: number): boolean {
  const h = r.tradingHours; if (!h) return true;
  const p = new Intl.DateTimeFormat("en-US", { timeZone: h.tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t));
  const g = (k: string) => p.find((x) => x.type === k)!.value;
  const day = g("weekday").toLowerCase().slice(0, 3) as (typeof DAYS)[number];
  if (!h.days.includes(day as never)) return false;
  const m = Number(g("hour")) * 60 + Number(g("minute"));
  const [fh, fm] = h.from.split(":").map(Number), [th, tm] = h.to.split(":").map(Number);
  const a = fh * 60 + fm, b = th * 60 + tm;
  return a <= b ? m >= a && m < b : m >= a || m < b; // overnight windows
}

/** Ordered pre-trade checks (ARCHITECTURE §2.3). Pure: returns the first failing rule or null. */
export interface GateInput {
  /** M4.2.1: run state at decision time; non-reducing orders are refused unless the run is active */
  runState?: "active" | "halted" | "paused";
  killSwitch: boolean; stockTokensAllowed: boolean; isEquity: boolean; reducing: boolean;
  tradingHoursOk: boolean; ordersToday: number; maxOrdersPerDay: number;
  positionUsdAfter: number; equity: number; maxPositionPct: number;
  exposureAfter: number; maxTotalExposurePct: number; cashNeeded: number; freeCash: number;
  sessionKey?: { perTxCapUsd: number; dailyCapUsd: number; spentTodayUsd: number; notional: number } | null;
}
export function gate(g: GateInput): { code: RejectCode; message: string } | null {
  if (g.killSwitch) return { code: "kill_switch", message: "Trading is paused platform-wide." };
  if (g.runState === "halted" && !g.reducing) return { code: "run_halted", message: "This run is halted; new orders are blocked until you resume." };
  if (g.runState === "paused" && !g.reducing) return { code: "run_paused", message: "This run is paused; new orders are blocked until you resume." };
  if (g.isEquity && !g.stockTokensAllowed && !g.reducing) return { code: "geo_restricted", message: "Stock Tokens aren't available for your account or region." };
  if (!g.tradingHoursOk && !g.reducing) return { code: "outside_trading_hours", message: "Outside this strategy's trading hours." };
  if (g.ordersToday >= g.maxOrdersPerDay) return { code: "max_orders_per_day", message: `Daily order limit (${g.maxOrdersPerDay}) reached.` };
  if (!g.reducing) {
    if (g.positionUsdAfter > (g.equity * g.maxPositionPct) / 100 + 1e-9) return { code: "max_position", message: `Position would be ${pct(g.positionUsdAfter, g.equity)}% of equity (limit ${g.maxPositionPct}%).` };
    if (g.exposureAfter > (g.equity * g.maxTotalExposurePct) / 100 + 1e-9) return { code: "max_total_exposure", message: `Total exposure would be ${pct(g.exposureAfter, g.equity)}% of equity (limit ${g.maxTotalExposurePct}%).` };
    if (g.cashNeeded > g.freeCash + 1e-9) return { code: "insufficient_funds", message: "Not enough free cash for this order." };
  }
  if (g.sessionKey) {
    const k = g.sessionKey;
    if (k.notional > k.perTxCapUsd) return { code: "session_key_cap", message: `Order $${k.notional.toFixed(2)} is above the session key's $${k.perTxCapUsd} per-trade cap.` };
    if (k.spentTodayUsd + k.notional > k.dailyCapUsd) return { code: "session_key_cap", message: `Session key daily cap $${k.dailyCapUsd} would be exceeded.` };
  }
  return null;
}
const pct = (a: number, b: number) => (b > 0 ? ((a / b) * 100).toFixed(1) : "∞");
