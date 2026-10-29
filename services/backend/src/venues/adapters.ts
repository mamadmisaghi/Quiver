import { COSTS, modelFill } from "../sim/costs";
import type { Venue } from "../../contracts/src/common";
import type { MarketData } from "./market";
import type { Registry } from "./registry";

export interface Quote {
  instrument: string; route: "uniswap_api" | "0x" | "jupiter" | "hyperliquid";
  price: number; qty: number; priceImpactBps: number; feeUsd: number; gasUsd: number | null;
  referencePrice: number | null; referenceSource: string | null; at: number;
}
export class VenueError extends Error { constructor(public code: "venue_unavailable" | "venue_read_only" | "quote_unavailable" | "unsupported_instrument", msg: string, public retryable = false) { super(msg); } }

export interface VenueAdapter {
  readonly id: Venue; readonly name: string;
  readonly capabilities: ("read" | "paper" | "testnet" | "live")[];
  status(): "up" | "degraded" | "down";
  note: string | null;
  /** Indicative quote. Never sends anything. */
  quote(instrument: string, side: "buy" | "sell", notionalUsd: number, t: number): Promise<Quote>;
}

const ROUTE: Record<Venue, Quote["route"]> = { robinhood: "uniswap_api", hyperliquid: "hyperliquid", solana: "jupiter", polymarket: "uniswap_api" };
const GAS: Record<Venue, number | null> = { robinhood: COSTS.robinhood.gasUsd, hyperliquid: null, solana: COSTS.solana.gasUsd, polymarket: null };

/** Mock adapter: real interface, synthetic quotes from the deterministic market + sqrt impact model. */
export class MockVenueAdapter implements VenueAdapter {
  readonly capabilities: VenueAdapter["capabilities"];
  note: string | null;
  down = false; // tests can simulate outages
  constructor(readonly id: Venue, readonly name: string, private mkt: MarketData, private reg: Registry) {
    this.capabilities = id === "polymarket" ? ["read"] : ["read", "paper"];
    this.note = id === "polymarket" ? "Read-only: odds are signals, Quiver never trades Polymarket." : "Mock data (synthetic).";
  }
  status() { return this.down ? "down" : "up"; }
  async quote(instrument: string, side: "buy" | "sell", notionalUsd: number, t: number): Promise<Quote> {
    if (this.id === "polymarket") throw new VenueError("venue_read_only", "Polymarket is read-only in Quiver.");
    if (this.down) throw new VenueError("venue_unavailable", `${this.name} quote timed out.`, true);
    const m = this.reg.get(instrument);
    if (!m || m.venue !== this.id) throw new VenueError("unsupported_instrument", `Unknown instrument ${instrument}`);
    const ref = this.mkt.price(instrument, t);
    if (!ref) throw new VenueError("quote_unavailable", `No price for ${m.symbol}.`, true);
    const eq = m.assetClass === "equity" || m.assetClass === "etf";
    const c = modelFill({ venue: this.id, ref: ref.value, side: side === "buy" ? 1 : -1, notional: notionalUsd, depthUsd: m.depthUsd, isEquity: eq, session: eq ? this.mkt.session(t) : "always" });
    return { instrument, route: ROUTE[this.id], price: c.price, qty: notionalUsd / c.price, priceImpactBps: Number(c.impactBps.toFixed(2)),
      feeUsd: c.feeUsd, gasUsd: GAS[this.id], referencePrice: ref.value, referenceSource: ref.source, at: t };
  }
}

export type Adapters = Record<Venue, VenueAdapter>;
export function mockAdapters(mkt: MarketData, reg: Registry): Adapters {
  return {
    robinhood: new MockVenueAdapter("robinhood", "Robinhood Chain", mkt, reg),
    hyperliquid: new MockVenueAdapter("hyperliquid", "Hyperliquid", mkt, reg),
    solana: new MockVenueAdapter("solana", "Solana (Jupiter)", mkt, reg),
    polymarket: new MockVenueAdapter("polymarket", "Polymarket", mkt, reg),
  };
}
