import type { MarketData, PricePoint, Session } from "./market";

/**
 * Per-wave read cache in front of MarketData. All runs in one engine wave evaluate at the same timestamp, so
 * identical (instrument, timeframe, t, n) reads are computed once per wave instead of once per run.
 * Keys include t, and the manager calls reset() at every wave start (the underlying market may have gained rounds),
 * so a cached value is never reused across waves. Returned arrays are shared: callers must not mutate them.
 */
export class MemoMarket implements MarketData {
  private m = new Map<string, unknown>(); hits = 0; misses = 0;
  constructor(readonly inner: MarketData, private maxEntries = 200_000) {}
  get synthetic() { return this.inner.synthetic; }
  reset() { this.m.clear(); }
  private get<T>(k: string, f: () => T): T {
    if (this.m.has(k)) { this.hits++; return this.m.get(k) as T; }
    this.misses++; const v = f(); if (this.m.size >= this.maxEntries) this.m.clear(); this.m.set(k, v); return v;
  }
  price(id: string, t: number): PricePoint | null { return this.get(`p|${id}|${t}`, () => this.inner.price(id, t)); }
  closes(id: string, tf: number, t: number, n: number) { return this.get(`c|${id}|${tf}|${t}|${n}`, () => this.inner.closes(id, tf, t, n)); }
  bars(id: string, tf: number, t: number, n: number) { return this.get(`b|${id}|${tf}|${t}|${n}`, () => this.inner.bars(id, tf, t, n)); }
  funding(id: string, t: number) { return this.get(`f|${id}|${t}`, () => this.inner.funding(id, t)); }
  session(t: number): Session { return this.get(`s|${Math.floor(t / 60_000)}`, () => this.inner.session(t)); }
  coverage(id: string, from: number, to: number) { return this.inner.coverage?.(id, from, to) ?? [{ source: this.inner.synthetic ? "mock_synthetic" : "vendor", from, to, gaps: 0, synthetic: this.inner.synthetic }]; }
}
