import type { InstrumentMeta, Registry } from "./registry";
import { nyseSession } from "./calendar";

export type Session = "open" | "closed" | "pre" | "post" | "halted" | "always";
/** stale=true: last known value carried while the market is closed (marks/display only; no new orders). */
export interface PricePoint { value: number; observedAt: number; source: string; /** M3.4: vendor-supplied 24h change (%), when the source has no history. */ change24hPct?: number; stale?: boolean; staleReason?: "market_closed" }

/** Market data used by the engine, simulator and backtester. Mock + live implementations share this. */
export interface MarketData {
  price(id: string, t: number): PricePoint | null;
  /** Close prices of the last n bars of `tfMs` ending at or before t (oldest first). No look-ahead. */
  closes(id: string, tfMs: number, t: number, n: number): number[] | null;
  /** OHLC needed for ATR (high/low/close), last n bars. */
  bars(id: string, tfMs: number, t: number, n: number): { o: number; h: number; l: number; c: number; t: number }[] | null;
  funding(id: string, t: number): PricePoint | null;
  session(t: number): Session;
  readonly synthetic: boolean;
  /** Optional: data provenance for a backtest window (default: whole window from one source). */
  /** M5.19 optional: open of the first bar with data covering/after t, only if that bar has finished by `now`. */
  openAt?(id: string, t: number, now: number): { value: number; t: number } | null;
  coverage?(id: string, from: number, to: number): { source: string; from: number; to: number; gaps: number; synthetic: boolean; modeled?: boolean }[];
}

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const noise = (seed: number, k: number) => { let x = Math.imul(seed ^ Math.imul(k, 2654435761), 1597334677) >>> 0; x ^= x >>> 15; x = Math.imul(x, 2246822519) >>> 0; x ^= x >>> 13; return (x / 4294967295) * 2 - 1; };

/**
 * Deterministic synthetic market: price(t) is a pure function of (instrument, t), so live paper runs,
 * backtests and tests agree. Multi-scale sinusoids + minute noise. CLEARLY SYNTHETIC — never shown as real.
 */
export class MockMarket implements MarketData {
  readonly synthetic = true;
  /** Optional per-instrument overrides for tests: fn(t) -> price | null (null = feed outage). */
  overrides = new Map<string, (t: number) => number | null>();
  constructor(private reg: Registry) {}

  private raw(m: InstrumentMeta, t: number): number {
    const s = hash(m.id), day = 86_400_000;
    const ph = (s % 1000) / 159;
    const a = m.vol * 4 * Math.sin((2 * Math.PI * t) / (37 * day) + ph);
    const b = m.vol * 1.6 * Math.sin((2 * Math.PI * t) / (6.3 * day) + ph * 2);
    const c = m.vol * 0.5 * Math.sin((2 * Math.PI * t) / (0.41 * day) + ph * 3);
    const n = m.vol * 0.06 * noise(s, Math.floor(t / 60_000));
    let p = m.base * Math.exp(a + b + c + n);
    if (m.kind === "outcome") p = Math.min(0.99, Math.max(0.01, m.base + (a + b + c + n) * 1.5));
    return p;
  }
  price(id: string, t: number): PricePoint | null {
    const ov = this.overrides.get(id);
    if (ov) { const v = ov(t); return v == null ? null : { value: v, observedAt: t, source: "mock" }; }
    const m = this.reg.get(id); if (!m) return null;
    const src = m.venue === "robinhood" ? (m.assetClass === "crypto" ? "mock_pool" : "mock_chainlink") : m.venue === "polymarket" ? "mock_polymarket" : m.venue === "hyperliquid" ? "mock_hyperliquid" : "mock_jupiter";
    return { value: this.raw(m, t), observedAt: t - (t % 1000), source: src };
  }
  closes(id: string, tfMs: number, t: number, n: number) {
    const b = this.bars(id, tfMs, t, n); return b ? b.map((x) => x.c) : null;
  }
  bars(id: string, tfMs: number, t: number, n: number) {
    if (!this.reg.get(id) && !this.overrides.has(id)) return null;
    const lastClose = Math.floor(t / tfMs) * tfMs; // last fully closed bar ends here
    const out: { o: number; h: number; l: number; c: number; t: number }[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const end = lastClose - i * tfMs, start = end - tfMs;
      const pts = [start, start + tfMs / 3, start + (2 * tfMs) / 3, end - 1].map((x) => this.price(id, x)?.value ?? NaN);
      if (pts.some(Number.isNaN)) return null;
      out.push({ o: pts[0], h: Math.max(...pts), l: Math.min(...pts), c: pts[3], t: end });
    }
    return out;
  }
  funding(id: string, t: number): PricePoint | null {
    const m = this.reg.get(id); if (!m || m.kind !== "perp") return null;
    const s = hash(id + ":f");
    const v = 0.00006 + 0.00009 * Math.sin((2 * Math.PI * t) / (2.7 * 86_400_000) + (s % 100) / 17);
    return { value: Number(v.toFixed(7)), observedAt: t - (t % 60_000), source: "mock_hyperliquid" };
  }
  session(t: number): Session { return nyseSession(t); }
}

export { nyseSession } from "./calendar";

import { PriceSource as PriceSourceZ, SignalSource as SignalSourceZ, type PriceSource, type SignalSource } from "../../contracts/src/common";
/** M3.2: normalize an internal source string to the contract enum (fail closed to "none"). */
export const toPriceSource = (s: string | undefined | null): PriceSource => (PriceSourceZ.safeParse(s).success ? (s as PriceSource) : "none");
export const toSignalSource = (s: string | undefined | null): SignalSource => (SignalSourceZ.safeParse(s).success ? (s as SignalSource) : "none");
