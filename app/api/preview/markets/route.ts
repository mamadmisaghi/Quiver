import { Market } from "@/lib/contracts/api";
import type { MarketCandidate } from "@/lib/contracts/workflow";
import { previewJson } from "@/lib/preview/server";
import { marketJson } from "@/services/backend/src/compile/markets";
import { nyseSession } from "@/services/backend/src/venues/calendar";
import { MOCK_INSTRUMENTS } from "@/services/backend/src/venues/registry";
import { quoteAsset } from "@/services/backend/src/workflows/quotes";

// The registry supplies identifiers only. Stock rows show underlying equity references.
const catalog = MOCK_INSTRUMENTS.filter(m => m.venue === "hyperliquid" || m.venue === "solana" || m.assetClass === "equity" || m.assetClass === "etf");

export async function GET() {
  const requests = new Map<string, Promise<unknown>>();
  const get = (url: string, init?: RequestInit) => {
    const key = url + (init?.body ?? "");
    let result = requests.get(key);
    if (!result) { result = marketJson(url, init, 30_000); requests.set(key, result); }
    return result;
  };
  const now = Date.now();
  const items = await Promise.all(catalog.map(async m => {
    const equity = m.assetClass === "equity" || m.assetClass === "etf";
    const source = m.venue === "hyperliquid" ? "hyperliquid" : m.venue === "solana" ? "dexscreener" : "preview_catalog";
    const candidate: MarketCandidate = { id: m.id, name: m.name, symbol: m.symbol, venue: m.venue, kind: m.kind, source,
      address: m.venue === "solana" ? m.id.split(":")[2] : null, url: null, maxLeverage: null, outcome: null, endDate: null };
    const { quote } = await quoteAsset({ id: "catalog", query: m.symbol, sourceText: m.name, venue: m.venue, kind: m.kind, outcome: null,
      resolution: { status: "matched", selectedId: m.id, candidates: [candidate], checkedAt: new Date(now).toISOString(), message: "" } }, get, process.env.TIINGO_API_KEY);
    return Market.parse({ id: m.id, symbol: m.symbol, name: m.name, venue: m.venue, kind: m.kind, assetClass: m.assetClass, price: quote ? String(quote.price) : null,
      priceAt: quote ? new Date(quote.observedAt).toISOString() : null, priceSource: quote ? (equity ? "tiingo_underlying" : source) : "none",
      priceIsReal: !!quote, priceStale: !!quote && now - quote.observedAt > 120_000, change24hPct: null,
      marketSession: equity ? nyseSession(now) : "always", tradable: true, geoRestricted: m.venue === "robinhood" });
  }));
  return previewJson({ items, nextCursor: null });
}
