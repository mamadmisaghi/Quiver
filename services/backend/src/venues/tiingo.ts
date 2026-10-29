// M5.18: optional Tiingo historical adapter (stock/ETF only). Paper/read-only data; key via TIINGO_API_KEY (empty by default).
// Daily bars: /tiingo/daily/<sym>/prices (adjusted OHLC). Intraday: /iex/<sym>/prices?resampleFreq=… (IEX bars).
// Hardened: per-call timeout, response size cap, redirect=error, LRU+TTL cache, in-flight dedupe, hourly token budget.
// The key is sent only in the Authorization header and never appears in logs or errors. Any failure → null (caller falls back).
import type { MarketData, PricePoint } from "./market";
export type Bar = { o: number; h: number; l: number; c: number; t: number };

export type TiingoHttp = (req: { url: string; headers: Record<string, string>; timeoutMs: number; maxBytes: number }) => Promise<{ status: number; text: string }>;
export const TIINGO_TIMEOUT_MS = 8_000;
export const TIINGO_MAX_BYTES = 4_000_000;
export class TiingoTooLarge extends Error { constructor() { super("tiingo response too large"); } }

export const fetchTiingoHttp: TiingoHttp = async (q) => {
  const r = await fetch(q.url, { headers: q.headers, redirect: "error", signal: AbortSignal.timeout(q.timeoutMs) });
  const len = Number(r.headers.get("content-length")); if (Number.isFinite(len) && len > q.maxBytes) throw new TiingoTooLarge();
  const reader = r.body?.getReader(); if (!reader) return { status: r.status, text: "" };
  const chunks: Uint8Array[] = []; let n = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.byteLength; if (n > q.maxBytes) { await reader.cancel(); throw new TiingoTooLarge(); } chunks.push(value); }
  return { status: r.status, text: Buffer.concat(chunks).toString("utf8") };
};

const DAY = 86_400_000;
/** Supported bar sizes (ms) → IEX resampleFreq. ≥ 1d uses the daily endpoint. */
const IEX_FREQ: Record<number, string> = { 60_000: "1min", 300_000: "5min", 900_000: "15min", 3_600_000: "1hour", 14_400_000: "4hour" };
export const tiingoSupports = (tfMs: number) => tfMs === DAY || tfMs in IEX_FREQ;
const SYM = /^[A-Z][A-Z0-9.-]{0,9}$/;
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface TiingoOpts { key: string; http?: TiingoHttp; now?: () => number; maxPerHour?: number; cacheSize?: number; ttlMs?: number; /** M5.20: per-owner network calls per hour (default 15) */ maxPerOwnerHour?: number; log?: (msg: string) => void }

export class TiingoHistory {
  private http: TiingoHttp; private now: () => number; private maxPerHour: number; private cacheSize: number; private ttlMs: number;
  private cache = new Map<string, { at: number; bars: Bar[] }>(); private inflight = new Map<string, Promise<Bar[] | null>>();
  private calls: number[] = []; private perOwner = new Map<string, number[]>(); private maxPerOwnerHour: number;
  readonly stats = { requests: 0, cacheHits: 0, failures: 0, rateLimited: 0 };
  constructor(private o: TiingoOpts) {
    this.http = o.http ?? fetchTiingoHttp; this.now = o.now ?? Date.now; this.maxPerHour = o.maxPerHour ?? 45; this.cacheSize = o.cacheSize ?? 200; this.ttlMs = o.ttlMs ?? 15 * 60_000; this.maxPerOwnerHour = o.maxPerOwnerHour ?? 15;
  }
  private log(m: string) { (this.o.log ?? ((s) => console.warn(JSON.stringify({ level: "warn", src: "tiingo", msg: s }))))(m.split(this.o.key).join("[redacted]")); }
  private take(owner?: string): boolean {
    const t = this.now(); this.calls = this.calls.filter((x) => t - x < 3_600_000);
    if (this.calls.length >= this.maxPerHour) return false;
    if (owner) { // M5.20: per-user share of the hourly budget (network calls only; cache hits are free)
      const mine = (this.perOwner.get(owner) ?? []).filter((x) => t - x < 3_600_000);
      if (mine.length >= this.maxPerOwnerHour) { this.perOwner.set(owner, mine); return false; }
      mine.push(t); this.perOwner.delete(owner); this.perOwner.set(owner, mine);
      if (this.perOwner.size > 10_000) this.perOwner.delete(this.perOwner.keys().next().value!);
    }
    this.calls.push(t); return true;
  }
  /** Bars stamped at bar END (same convention as MarketData.bars), ascending, covering [from, to]. null = unavailable. */
  async bars(symbol: string, tfMs: number, from: number, to: number, owner?: string): Promise<Bar[] | null> {
    if (!this.o.key || !SYM.test(symbol) || !tiingoSupports(tfMs) || !(to > from)) return null;
    const daily = tfMs === DAY;
    const url = daily
      ? `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol.toLowerCase())}/prices?startDate=${ymd(from)}&endDate=${ymd(to)}`
      : `https://api.tiingo.com/iex/${encodeURIComponent(symbol.toLowerCase())}/prices?startDate=${ymd(from)}&endDate=${ymd(to)}&resampleFreq=${IEX_FREQ[tfMs]}&columns=open,high,low,close`;
    const hit = this.cache.get(url);
    if (hit && this.now() - hit.at < this.ttlMs) { this.stats.cacheHits++; this.cache.delete(url); this.cache.set(url, hit); return hit.bars; }
    const p0 = this.inflight.get(url); if (p0) return p0;
    if (!this.take(owner)) { this.stats.rateLimited++; this.log("hourly request budget exhausted; using fallback"); return null; }
    const p = (async () => {
      try {
        this.stats.requests++;
        const r = await this.http({ url, headers: { Authorization: `Token ${this.o.key}`, Accept: "application/json" }, timeoutMs: TIINGO_TIMEOUT_MS, maxBytes: TIINGO_MAX_BYTES });
        if (r.status !== 200) throw new Error(`status ${r.status}`);
        if (r.text.length > TIINGO_MAX_BYTES) throw new TiingoTooLarge();
        const rows = JSON.parse(r.text) as unknown;
        if (!Array.isArray(rows)) throw new Error("unexpected body");
        const out: Bar[] = [];
        for (const x of rows as Record<string, unknown>[]) {
          const d = Date.parse(String(x.date)); if (!Number.isFinite(d)) continue;
          const [o, h, l, c] = daily ? [x.adjOpen ?? x.open, x.adjHigh ?? x.high, x.adjLow ?? x.low, x.adjClose ?? x.close] : [x.open, x.high, x.low, x.close];
          const v = [o, h, l, c].map(Number); if (v.some((n) => !Number.isFinite(n) || n <= 0)) continue;
          const end = daily ? Math.floor(d / DAY) * DAY + 21 * 3_600_000 : d + tfMs; // daily: 21:00Z close of that date; IEX `date` = bar start
          if (end > this.now()) continue; // never return an unfinished bar
          out.push({ o: v[0], h: v[1], l: v[2], c: v[3], t: end });
        }
        out.sort((a, b) => a.t - b.t);
        if (!out.length) throw new Error("no bars");
        this.cache.set(url, { at: this.now(), bars: out });
        while (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value!);
        return out;
      } catch (e) {
        this.stats.failures++; this.log(`${symbol} ${daily ? "daily" : IEX_FREQ[tfMs]} failed: ${e instanceof Error ? e.message : "error"}`); return null;
      } finally { this.inflight.delete(url); }
    })();
    this.inflight.set(url, p); return p;
  }
}

/** Backtest overlay: serves preloaded Tiingo series for some instruments, delegates everything else to `inner`. */
export class TiingoOverlay implements MarketData {
  constructor(private inner: MarketData, private series: Map<string, { tfMs: number; bars: Bar[]; source: string }>) {}
  get synthetic() { return this.inner.synthetic; }
  private upto(id: string, t: number) { const s = this.series.get(id)!; let lo = 0, hi = s.bars.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s.bars[m].t <= t) lo = m + 1; else hi = m; } return lo; }
  price(id: string, t: number): PricePoint | null {
    if (!this.series.has(id)) return this.inner.price(id, t);
    const s = this.series.get(id)!; const i = this.upto(id, t) - 1; if (i < 0) return null;
    const b = s.bars[i]; if (t - b.t > 4 * DAY) return null;
    // within one bar of its close the bar-resolution value is as fresh as this series gets; older → real (stale) timestamp
    return { value: b.c, observedAt: t - b.t <= s.tfMs ? t : b.t, source: s.source };
  }
  bars(id: string, tfMs: number, t: number, n: number): Bar[] | null {
    if (!this.series.has(id)) return this.inner.bars(id, tfMs, t, n);
    const s = this.series.get(id)!; const k = this.upto(id, t);
    if (tfMs === s.tfMs) return k >= n ? s.bars.slice(k - n, k) : null;
    if (tfMs % s.tfMs !== 0 || s.tfMs >= DAY) return null;
    const out: Bar[] = []; // aggregate base bars into complete tfMs buckets ending ≤ t
    for (const b of s.bars.slice(0, k)) {
      const end = Math.ceil(b.t / tfMs) * tfMs; if (end > t) break;
      const last = out.at(-1);
      if (last && last.t === end) { last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; } else out.push({ ...b, t: end });
    }
    return out.length >= n ? out.slice(-n) : null;
  }
  closes(id: string, tfMs: number, t: number, n: number): number[] | null { return this.series.has(id) ? this.bars(id, tfMs, t, n)?.map((b) => b.c) ?? null : this.inner.closes(id, tfMs, t, n); }
  openAt(id: string, t: number, now: number) {
    if (!this.series.has(id)) return this.inner.openAt ? this.inner.openAt(id, t, now) : (() => { const p = this.inner.price(id, t); return p ? { value: p.value, t } : null; })();
    const s = this.series.get(id)!; const i = this.upto(id, t); const b = s.bars[i]; // first bar ending after t
    if (!b || b.t > now) return null;
    return { value: b.o, t: Math.max(t, b.t - s.tfMs) };
  }
  funding(id: string, t: number) { return this.inner.funding(id, t); }
  session(t: number) { return this.inner.session(t); }
  coverage(id: string, from: number, to: number) {
    const s = this.series.get(id); if (!s) return this.inner.coverage?.(id, from, to) ?? [{ source: this.inner.synthetic ? "mock" : "live", from, to, gaps: 0, synthetic: this.inner.synthetic }];
    return [{ source: s.source, from: Math.max(from, s.bars[0].t), to: Math.min(to, s.bars.at(-1)!.t), gaps: 0, synthetic: false }];
  }
}
