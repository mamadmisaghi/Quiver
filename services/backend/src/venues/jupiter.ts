import type { PricePoint } from "./market";
export const JUP_SOURCE = "jupiter_readonly";
/**
 * M3.3: read-only Jupiter Price API v3 (keyless, 0.5 req/s). Current price only — Jupiter has no history endpoint,
 * so past prices/bars are null (fail closed), never mock.
 */
export class JupiterPrice {
  private last: { value: number; at: number; ch: number | null } | null = null;
  constructor(readonly mint: string, private api: string, private fetcher: (u: string) => Promise<unknown> = async (u) => {
    const response = await fetch(u, { signal: AbortSignal.timeout(8000), headers: this.apiKey ? { "x-api-key": this.apiKey } : {} });
    if (!response.ok) throw new Error("jupiter: price service unavailable");
    return response.json();
  }, private maxAgeMs = 180_000, private apiKey?: string) {}
  async refresh(now = Date.now()) {
    const r = (await this.fetcher(`${this.api}?ids=${this.mint}`)) as Record<string, { usdPrice?: number; priceChange24h?: number }>;
    const v = r?.[this.mint]?.usdPrice;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) { this.last = null; throw new Error("jupiter: no price"); }
    const ch = r[this.mint].priceChange24h; this.last = { value: v, at: now, ch: typeof ch === "number" && Number.isFinite(ch) ? ch : null };
  }
  price(t: number): PricePoint | null {
    const l = this.last; if (!l || t < l.at - this.maxAgeMs || t - l.at > this.maxAgeMs) return null;
    return { value: l.value, observedAt: l.at, source: JUP_SOURCE, ...(l.ch != null ? { change24hPct: l.ch } : {}) };
  }
}
