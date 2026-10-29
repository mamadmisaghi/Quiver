import type { Signal, Strategy } from "../../contracts/src/strategy";
import type { MarketData } from "../venues/market";
import { cronMatches } from "./cron";
import { TF_MS, atr, bb, ema, lookback, pctChange, rsi, sma } from "./indicators";

export type Val = number | string | boolean | null;
export interface SignalSnap { fields: Record<string, Val>; observedAt: number; source: string; stale: boolean; staleReason?: "market_closed" | "no_data" }
export type Snapshot = Record<string, SignalSnap>;
export interface PositionView { qty: number; avgEntry: number; mark: number | null }

export const SIGNAL_FIELDS: Record<Signal["kind"], string[]> = {
  price: ["value"], indicator: ["value"], funding: ["value"], odds: ["value"], market_session: ["value"], timer: ["value"], position: ["qty", "pnl_pct", "value_usd"],
};

/** Build the point-in-time snapshot. Anything older than maxAgeSeconds is marked stale and its fields become null (unknown). */
export function buildSnapshot(s: Strategy, mkt: MarketData, t: number, pos: (id: string) => PositionView | undefined): Snapshot {
  const out: Snapshot = {};
  for (const sig of s.signals) {
    let snap: SignalSnap;
    const unknown = (src: string): SignalSnap => ({ fields: Object.fromEntries(SIGNAL_FIELDS[sig.kind].map((f) => [f, null])), observedAt: t, source: src, stale: true, staleReason: "no_data" });
    switch (sig.kind) {
      case "price": case "odds": { const p = mkt.price(sig.params.instrument, t); snap = p ? { fields: { value: p.value }, observedAt: p.observedAt, source: p.source, stale: false, ...(p.staleReason ? { staleReason: p.staleReason } : {}) } : unknown("none"); break; }
      case "funding": { const p = mkt.funding(sig.params.instrument, t); snap = p ? { fields: { value: p.value }, observedAt: p.observedAt, source: p.source, stale: false } : unknown("none"); break; }
      case "indicator": {
        const { instrument, name, period, timeframe } = sig.params; const tf = TF_MS[timeframe];
        const n = lookback(name, period); let v: number | null = null;
        if (name === "atr") { const b = mkt.bars(instrument, tf, t, n); v = b ? atr(b, period) : null; }
        else {
          const c = mkt.closes(instrument, tf, t, n);
          if (c) v = name === "sma" ? sma(c, period) : name === "ema" ? ema(c, period) : name === "rsi" ? rsi(c, period) : name === "bb_upper" ? bb(c, period, 1) : name === "bb_lower" ? bb(c, period, -1) : pctChange(c, period);
        }
        // Indicator is as-of the last closed bar; its age is measured from that bar close, but bar-based signals are fresh for one bar.
        snap = v == null ? unknown("none") : { fields: { value: v }, observedAt: Math.floor(t / tf) * tf, source: mkt.price(instrument, t)?.source ?? "none", stale: false };
        if (!snap.stale && t - snap.observedAt > Math.max(sig.maxAgeSeconds * 1000, tf)) snap = unknown("none");
        out[sig.id] = snap; continue;
      }
      case "market_session": snap = { fields: { value: mkt.session(t) }, observedAt: t, source: "calendar", stale: false }; break;
      case "timer": { let v: boolean; try { v = cronMatches(sig.params.cron, sig.params.tz, t); } catch { snap = unknown("timer"); break; } snap = { fields: { value: v }, observedAt: t, source: "timer", stale: false }; break; }
      case "position": {
        const p = pos(sig.params.instrument); const mark = p?.mark ?? mkt.price(sig.params.instrument, t)?.value ?? null;
        const qty = p?.qty ?? 0; const pnl = p && qty !== 0 && mark != null ? ((mark - p.avgEntry) / p.avgEntry) * 100 * Math.sign(qty) : 0;
        snap = { fields: { qty, pnl_pct: pnl, value_usd: mark == null ? null : Math.abs(qty) * mark }, observedAt: t, source: "portfolio", stale: false }; break;
      }
    }
    if (!snap.stale && t - snap.observedAt > sig.maxAgeSeconds * 1000) snap = { ...snap, fields: Object.fromEntries(Object.keys(snap.fields).map((k) => [k, null])), stale: true };
    out[sig.id] = snap;
  }
  return out;
}
