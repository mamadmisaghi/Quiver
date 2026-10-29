import type { Instrument } from "../../contracts/src/strategy";

export interface InstrumentMeta extends Instrument {
  name: string;
  /** Mock reference price & daily vol used by the deterministic mock market. */
  base: number; vol: number;
  /** Mock pool depth (USD notional that moves price ~1%). */
  depthUsd: number;
  /** true = address/id is a placeholder; never usable outside mock mode (fail closed). */
  mock: boolean;
  decimals?: number;
}

/**
 * MOCK registry. Robinhood Stock Token addresses are PLACEHOLDERS (0x…a1 etc.) — the real list is
 * unverified (V4). In testnet mode only entries in config/verified/46630.json are tradable.
 */
export const MOCK_INSTRUMENTS: InstrumentMeta[] = [
  { id: "robinhood:token:0x00000000000000000000000000000000000000a1", venue: "robinhood", kind: "token", symbol: "NVDA", assetClass: "equity", name: "NVIDIA", base: 182, vol: 0.03, depthUsd: 400_000, mock: true },
  { id: "robinhood:token:0x00000000000000000000000000000000000000a2", venue: "robinhood", kind: "token", symbol: "AAPL", assetClass: "equity", name: "Apple", base: 231, vol: 0.018, depthUsd: 400_000, mock: true },
  { id: "robinhood:token:0x00000000000000000000000000000000000000a3", venue: "robinhood", kind: "token", symbol: "TSLA", assetClass: "equity", name: "Tesla", base: 262, vol: 0.04, depthUsd: 300_000, mock: true },
  { id: "robinhood:token:0x00000000000000000000000000000000000000a4", venue: "robinhood", kind: "token", symbol: "SPY", assetClass: "etf", name: "SPDR S&P 500", base: 584, vol: 0.01, depthUsd: 800_000, mock: true },
  { id: "robinhood:token:0x00000000000000000000000000000000000000a5", venue: "robinhood", kind: "token", symbol: "MSFT", assetClass: "equity", name: "Microsoft", base: 498, vol: 0.02, depthUsd: 400_000, mock: true },
  { id: "robinhood:token:0x00000000000000000000000000000000000000e1", venue: "robinhood", kind: "token", symbol: "WETH", assetClass: "crypto", name: "Wrapped Ether", base: 3400, vol: 0.035, depthUsd: 2_000_000, mock: true },
  { id: "hl:perp:BTC", venue: "hyperliquid", kind: "perp", symbol: "BTC", assetClass: "crypto", name: "Bitcoin perp", base: 68000, vol: 0.03, depthUsd: 20_000_000, mock: true },
  { id: "hl:perp:ETH", venue: "hyperliquid", kind: "perp", symbol: "ETH", assetClass: "crypto", name: "Ether perp", base: 3400, vol: 0.035, depthUsd: 10_000_000, mock: true },
  { id: "hl:perp:SOL", venue: "hyperliquid", kind: "perp", symbol: "SOL", assetClass: "crypto", name: "Solana perp", base: 165, vol: 0.045, depthUsd: 5_000_000, mock: true },
  { id: "sol:token:JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", venue: "solana", kind: "token", symbol: "JUP", assetClass: "crypto", name: "Jupiter", base: 0.92, vol: 0.06, depthUsd: 1_000_000, mock: true },
  { id: "sol:token:So11111111111111111111111111111111111111112", venue: "solana", kind: "token", symbol: "SOL", assetClass: "crypto", name: "Solana", base: 165, vol: 0.045, depthUsd: 1_000_000, mock: true },
  { id: "pm:outcome:fed-cut-december:YES", venue: "polymarket", kind: "outcome", symbol: "FEDCUT", assetClass: "outcome", name: "Fed cuts in December? — YES", base: 0.66, vol: 0.08, depthUsd: 100_000, mock: true },
];

export class Registry {
  private byId = new Map<string, InstrumentMeta>();
  constructor(items: InstrumentMeta[]) { for (const i of items) this.byId.set(i.id, i); }
  get(id: string) { return this.byId.get(id); }
  all() { return [...this.byId.values()]; }
  bySymbol(sym: string, venue?: string) { return this.all().find((i) => i.symbol === sym.toUpperCase() && (!venue || i.venue === venue)); }
}
