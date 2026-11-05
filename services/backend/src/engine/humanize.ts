import type { Expr, Signal, Strategy } from "../../contracts/src/strategy";
import type { Registry } from "../venues/registry";
import { workflowView } from "./workflow-view";

const VENUE: Record<string, string> = { robinhood: "Robinhood Chain", hyperliquid: "Hyperliquid", solana: "Solana", polymarket: "Polymarket" };
const OPS: Record<string, string> = { lt: "is below", lte: "is at or below", gt: "is above", gte: "is at or above", eq: "is", neq: "is not", crosses_above: "crosses above", crosses_below: "crosses below" };
const money = (v: string) => "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Deterministic, model-free English rendering (Watch / When / Do / Exit). */
export function humanize(s: Strategy, reg: Registry) {
  if (s.workflow) return workflowView(s.workflow).humanized;
  const sym = (id: string) => reg.get(id)?.symbol ?? id;
  const sigs = new Map(s.signals.map((x) => [x.id, x]));
  const sigName = (sig: Signal): string => {
    switch (sig.kind) {
      case "price": return `${sym(sig.params.instrument)} price`;
      case "indicator": { const n = { sma: "average", ema: "EMA", rsi: "RSI", atr: "ATR", bb_upper: "upper Bollinger band", bb_lower: "lower Bollinger band", pct_change: "% change" }[sig.params.name]; return `${sym(sig.params.instrument)} ${sig.params.period}-${tfWord(sig.params.timeframe)} ${n}`; }
      case "funding": return `${sym(sig.params.instrument)} funding rate`;
      case "odds": return `${reg.get(sig.params.instrument)?.name.replace(/ \(MOCK\)$/, "") ?? sig.params.instrument} odds`;
      case "market_session": return "US market session";
      case "timer": return `schedule "${sig.params.cron}" (${sig.params.tz})`;
      case "position": return `my ${sym(sig.params.instrument)} position`;
    }
  };
  const fmtLit = (v: number | string | boolean, ctx?: Signal) => {
    if (typeof v !== "number") return String(v);
    if (ctx?.kind === "odds") return `${+(v * 100).toFixed(2)}%`;
    if (ctx?.kind === "funding") return `${+(v * 100).toFixed(4)}%/h`;
    return String(v);
  };
  const operand = (o: { ref: string } | { lit: number | string | boolean }, ctx?: Signal) => {
    if ("lit" in o) return fmtLit(o.lit, ctx);
    const [sid, f] = o.ref.split("."); const sg = sigs.get(sid); if (!sg) return o.ref;
    return f === "value" ? sigName(sg) : `${sigName(sg)} ${f.replace("_", " ")}`;
  };
  const ctxOf = (o: { ref: string } | { lit: unknown }) => ("ref" in o ? sigs.get(o.ref.split(".")[0]) : undefined);
  const expr = (e: Expr): string => {
    switch (e.op) {
      case "and": return e.args.map(expr).join(" and ");
      case "or": return "(" + e.args.map(expr).join(" or ") + ")";
      case "not": return `not (${expr(e.arg)})`;
      case "between": return `${operand(e.value)} is between ${operand(e.low, ctxOf(e.value))} and ${operand(e.high, ctxOf(e.value))}`;
      default: return `${operand(e.left)} ${OPS[e.op]} ${operand(e.right, ctxOf(e.left))}`;
    }
  };
  const watch = s.signals.map((g) => `${cap(sigName(g))}${"instrument" in g.params && reg.get(g.params.instrument) ? ` · ${VENUE[reg.get(g.params.instrument)!.venue]}` : ""}`);
  const when = s.triggers.map((t) => {
    let line = cap(expr(t.when)); if (t.forMinutes > 0) line += `, for ${dur(t.forMinutes)}`;
    line += t.maxFires === 1 ? " (once)" : t.maxFires === null ? `; repeats, at most every ${dur(t.cooldownMinutes)}` : `; up to ${t.maxFires} times, ${dur(t.cooldownMinutes)} apart`;
    return line;
  });
  const doL = s.actions.map((a) => {
    const size = a.size.unit === "usd" ? money(a.size.value) : a.size.unit === "pct_equity" ? `${a.size.value}% of equity` : `${a.size.value} units`;
    const verb = a.type === "close" ? "Close" : a.side === "buy" ? "Buy" : a.side === "sell" ? "Sell" : a.side === "long" ? "Open a long" : "Open a short";
    const lev = a.leverage > 1 ? ` at ${a.leverage}×` : "";
    const m = reg.get(a.instrument);
    return a.type === "close" ? `Close ${sym(a.instrument)} on ${VENUE[m?.venue ?? ""] ?? "?"}` : `${verb} ${size} of ${sym(a.instrument)}${lev} on ${VENUE[m?.venue ?? ""] ?? "?"} (max slippage ${a.order.maxSlippageBps / 100}%)`;
  });
  const exit: string[] = [];
  for (const a of s.actions) {
    const x = a.exits; if (!x) continue; const n = sym(a.instrument); const parts: string[] = [];
    if (x.takeProfit) parts.push(`take profit at ${x.takeProfit.unit === "pct" ? "+" + x.takeProfit.value + "%" : money(x.takeProfit.value)}`);
    if (x.stopLoss) parts.push(`stop at ${x.stopLoss.unit === "pct" ? "−" + x.stopLoss.value + "%" : money(x.stopLoss.value)}`);
    if (x.trailingStopPct) parts.push(`trail ${x.trailingStopPct}%`);
    if (x.timeExitHours) parts.push(`exit after ${x.timeExitHours}h`);
    if (x.takeProfits?.length) parts.push(...x.takeProfits.map((r) => `sell ${(Number(r.sellFraction) * 100).toFixed(2)}% of the original position at +${r.atPct}%`));
    if (parts.length) exit.push(`${n}: ${parts.join(", ")}`);
  }
  const r = s.risk;
  exit.push(`Risk: max ${r.maxPositionPct}% per position, pause after −${r.maxDailyLossPct}% in a day, max ${r.maxOrdersPerDay} orders/day`);
  return { watch, when, do: doL, exit };
}
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const tfWord = (tf: string) => ({ "1m": "minute", "5m": "5-minute", "15m": "15-minute", "1h": "hour", "4h": "4-hour", "1d": "day" }[tf] ?? tf);
const dur = (m: number) => (m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? "" : "s"}` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${m} min`);
