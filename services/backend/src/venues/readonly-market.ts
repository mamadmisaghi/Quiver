import type { InstrumentMeta, Registry } from "./registry";
import { MockMarket, type MarketData, type PricePoint, type Session } from "./market";
import { closedSince, nyseSession } from "./calendar";
import type { EodBar, EodVendor } from "./eod-vendor";
import type { JupiterPrice } from "./jupiter";
import { SOURCE, type ChainlinkReader, type Round } from "./chainlink";

/** Which verified feed prices which instrument. Only Robinhood-venue instruments; HL/Solana/Polymarket stay mock. */
export function feedSymbolFor(m: InstrumentMeta): string | null {
  if (m.venue !== "robinhood") return null;
  return m.symbol === "WETH" ? "ETH" : m.symbol;
}

/**
 * 'mainnet-readonly' MarketData: Robinhood instruments priced from verified Chainlink 4663 feeds
 * (latest + round history via eth_call), everything else from the labelled mock market.
 * Fail closed: a mapped instrument whose feed is unverified/stale/unloaded returns null — it never
 * silently falls back to synthetic prices. `synthetic` stays true because the market is mixed;
 * each PricePoint carries its own `source`.
 */
export class ReadonlyMarket implements MarketData {
  readonly synthetic = true;
  private rounds = new Map<string, Round[]>();
  private latest = new Map<string, PricePoint | null>();
  private mock: MockMarket;
  constructor(private reg: Registry, private reader: ChainlinkReader, private hasFeed: (sym: string) => boolean,
    private heartbeatSec: (sym: string) => number = () => 86_400, private graceSec = 600, private jup: JupiterPrice | null = null) { this.mock = new MockMarket(reg); }
  /** M3.3: JUP priced from the verified Jupiter Price API (current only) when configured. */
  private isJup(id: string) { return !!this.jup && this.reg.get(id)?.symbol === "JUP"; }
  private eod = new Map<string, { vendor: string; bars: EodBar[] }>();
  /** Load MODELED end-of-day history (underlying stock) for equity feeds, used only before the first on-chain round. */
  async loadModeled(vendor: EodVendor, fromMs: number) {
    const errors: string[] = [];
    for (const m of this.reg.all()) {
      const s = this.mapped(m.id); if (!s || s === "__unverified__" || !(m.assetClass === "equity" || m.assetClass === "etf") || this.eod.has(s)) continue;
      const first = this.rounds.get(s)?.[0]?.updatedAt ?? Date.now();
      if (first <= fromMs) continue;
      try { this.eod.set(s, { vendor: vendor.name, bars: await vendor.daily(s, fromMs, first) }); } catch (e) { errors.push(`${s}: ${(e as Error).message}`); }
    }
    return { errors };
  }
  coverage(id: string, from: number, to: number) {
    if (this.isJup(id)) return [{ source: "none", from, to, gaps: 1, synthetic: false }]; // no Jupiter history
    const s = this.mapped(id);
    if (!s) return [{ source: "mock_synthetic", from, to, gaps: 0, synthetic: true }];
    if (s === "__unverified__") return [{ source: "none", from, to, gaps: 0, synthetic: false }];
    const first = this.rounds.get(s)?.[0]?.updatedAt ?? Infinity; const out = [];
    if (from < first) { const e = this.eod.get(s); out.push(e?.bars.length ? { source: `modeled_eod_${e.vendor}`, from, to: Math.min(first, to), gaps: 0, synthetic: false, modeled: true } : { source: "none", from, to: Math.min(first, to), gaps: 1, synthetic: false }); }
    if (to > first) out.push({ source: SOURCE, from: Math.max(from, first), to, gaps: this.gaps(s), synthetic: false });
    return out;
  }
  /** Rounds that failed to load per symbol on the last refresh (backtest data-coverage gaps). */
  gaps(sym: string) { return this.reader.gaps.get(sym) ?? 0; }
  /** Earliest loaded round time for an instrument (history depth), or null. */
  depth(id: string) { const s = this.mapped(id); const r = s ? this.rounds.get(s) : undefined; return r?.length ? r[0].updatedAt : null; }

  mapped(id: string): string | null { const m = this.reg.get(id); const s = m ? feedSymbolFor(m) : null; return s && this.hasFeed(s) ? s : s ? "__unverified__" : null; }

  /** Pull latest + history for every mapped feed. Errors leave that symbol empty (→ null prices). */
  async refresh(historyMs = 365 * 86_400_000, now = Date.now()) {
    const syms = new Set(this.reg.all().map((m) => this.mapped(m.id)).filter((s): s is string => !!s && s !== "__unverified__"));
    const errors: string[] = [];
    await Promise.all([...syms].map(async (s) => {
      try {
        this.latest.set(s, await this.reader.latest(s));
        const have = this.rounds.get(s);
        if (!have?.length) this.rounds.set(s, await this.reader.history(s, now - historyMs));
        else { // incremental: only rounds newer than what we hold
          const lastT = have[have.length - 1].updatedAt; const fresh = (await this.reader.history(s, lastT)).filter((x) => x.updatedAt > lastT);
          if (fresh.length) this.rounds.set(s, [...have, ...fresh]);
        }
      }
      catch (e) { this.latest.set(s, null); errors.push(`${s}: ${(e as Error).message}`); }
    }));
    return { symbols: [...syms], errors };
  }
  /**
   * Staleness policy (fail closed):
   *  - fresh: last round within heartbeat + grace of t
   *  - equities only: if the market is closed (night/weekend/holiday) and the last round came no earlier than
   *    heartbeat before the close started, return it with stale=true ("market_closed"): marks and display only,
   *    the executor rejects orders on stale points
   *  - otherwise null (unknown) — never a mock fallback
   */
  price(id: string, t: number): PricePoint | null {
    if (this.isJup(id)) return this.jup!.price(t);
    const s = this.mapped(id); if (!s) return this.mock.price(id, t);
    if (s === "__unverified__") return null;
    const r = this.rounds.get(s); if (!r?.length) return null;
    const i = idxAt(r, t);
    if (i < 0) { // before the first on-chain round: modeled EOD (underlying stock) if loaded
      const e = this.eod.get(s); if (!e) return null;
      let lo = 0, hi = e.bars.length - 1, a = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (e.bars[mid].t <= t) { a = mid; lo = mid + 1; } else hi = mid - 1; }
      return a < 0 || t - e.bars[a].t > 5 * 86_400_000 ? null : { value: e.bars[a].close, observedAt: e.bars[a].t, source: `modeled_eod_${e.vendor}` };
    }
    const x = r[i]; const hb = (this.heartbeatSec(s) + this.graceSec) * 1000;
    if (i === r.length - 1 && !this.latest.get(s) && t >= x.updatedAt + hb) return null; // refresh found latest stale
    if (t - x.updatedAt <= hb) return { value: x.answer, observedAt: x.updatedAt, source: SOURCE };
    const m = this.reg.get(id)!; const eq = m.assetClass === "equity" || m.assetClass === "etf";
    const since = eq ? closedSince(t) : null;
    if (since != null && x.updatedAt >= since - hb) return { value: x.answer, observedAt: x.updatedAt, source: SOURCE, stale: true, staleReason: "market_closed" };
    return null;
  }
  bars(id: string, tfMs: number, t: number, n: number) {
    if (this.isJup(id)) return null;
    if (!this.mapped(id)) return this.mock.bars(id, tfMs, t, n);
    const lastClose = Math.floor(t / tfMs) * tfMs; const out: { o: number; h: number; l: number; c: number; t: number }[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const end = lastClose - i * tfMs, start = end - tfMs;
      const o = this.price(id, start)?.value, c = this.price(id, end - 1)?.value;
      if (o == null || c == null) return null;
      const rr = this.rounds.get(this.mapped(id)!) ?? []; const inside: number[] = [];
      for (let j = Math.max(0, idxAt(rr, start - 1) + 1); j < rr.length && rr[j].updatedAt < end; j++) inside.push(rr[j].answer);
      out.push({ o, h: Math.max(o, c, ...inside), l: Math.min(o, c, ...inside), c, t: end });
    }
    return out;
  }
  closes(id: string, tfMs: number, t: number, n: number) { const b = this.bars(id, tfMs, t, n); return b ? b.map((x) => x.c) : null; }
  funding(id: string, t: number) { return this.mock.funding(id, t); }
  session(t: number): Session { return nyseSession(t); }
}

/** Index of the last round with updatedAt <= t (binary search), or -1. */
export function idxAt(r: Round[], t: number) { let lo = 0, hi = r.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (r[m].updatedAt <= t) { a = m; lo = m + 1; } else hi = m - 1; } return a; }
