/**
 * Optional MODELED history for backtests older than the on-chain feed: end-of-day closes of the UNDERLYING stock
 * (not the token) from a free-tier vendor. Off unless an API key is configured. Each close is stamped at 21:00 UTC
 * on its date (>= 16:00 New York close in both EST and EDT), so a backtest never sees a close before it existed.
 * Vendor terms: see SIGNOFF.md (V11) — free tiers are typically personal/non-commercial use only.
 */
export interface EodBar { t: number; close: number }
export interface EodVendor { readonly name: string; daily(symbol: string, fromMs: number, toMs: number): Promise<EodBar[]> }
type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Tiingo EOD (https://www.tiingo.com/documentation/end-of-day). Uses adjusted close (splits/dividends). */
export class TiingoEod implements EodVendor {
  readonly name = "tiingo";
  constructor(private apiKey: string, private fetchFn: Fetch = fetch as unknown as Fetch) {}
  async daily(symbol: string, fromMs: number, toMs: number): Promise<EodBar[]> {
    const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(symbol.toLowerCase())}/prices?startDate=${day(fromMs)}&endDate=${day(toMs)}&format=json`;
    const r = await this.fetchFn(url, { headers: { Authorization: `Token ${this.apiKey}`, "Content-Type": "application/json" } });
    if (!r.ok) throw new Error(`Tiingo ${symbol}: HTTP ${r.status}`);
    const rows = (await r.json()) as { date: string; adjClose?: number; close?: number }[];
    return rows.map((x) => ({ t: Date.parse(x.date.slice(0, 10) + "T21:00:00Z"), close: Number(x.adjClose ?? x.close) })).filter((x) => x.close > 0).sort((a, b) => a.t - b.t);
  }
}
