import type { Action } from "../../contracts/src/strategy";
import type { InstrumentMeta } from "../venues/registry";

export interface Pos { instrument: string; kind: InstrumentMeta["kind"]; qty: number; avgEntry: number; leverage: number; openedAt: number; peak: number; trough: number; actionId: string; exits?: Action["exits"]; realizedUsd: number }

/** Paper account. Spot: cash pays notional. Perps: cash pays fees only; margin = |qty|·avg/leverage is reserved. */
export class PaperAccount {
  cash: number; realized = 0; fees = 0;
  positions = new Map<string, Pos>();
  dayKey = ""; dayStartEquity: number; ordersToday = 0;
  constructor(public startingEquity: number) { this.cash = startingEquity; this.dayStartEquity = startingEquity; }

  equity(mark: (id: string) => number | null): number {
    let e = this.cash;
    for (const p of this.positions.values()) { const m = mark(p.instrument) ?? p.avgEntry; e += p.kind === "perp" ? p.qty * (m - p.avgEntry) : p.qty * m; }
    return e;
  }
  exposure(mark: (id: string) => number | null) { let x = 0; for (const p of this.positions.values()) x += Math.abs(p.qty) * (mark(p.instrument) ?? p.avgEntry); return x; }
  marginUsed() { let m = 0; for (const p of this.positions.values()) if (p.kind === "perp") m += (Math.abs(p.qty) * p.avgEntry) / p.leverage; return m; }
  freeCash() { return this.cash - this.marginUsed(); }
  rollDay(t: number, mark: (id: string) => number | null) {
    const k = new Date(t).toISOString().slice(0, 10);
    if (k !== this.dayKey) { this.dayKey = k; this.ordersToday = 0; this.dayStartEquity = this.equity(mark); }
  }
  /** Apply a fill. signedQty > 0 buys/longs, < 0 sells/shorts. Returns realized PnL of this fill. */
  apply(meta: InstrumentMeta, signedQty: number, price: number, fee: number, t: number, actionId: string, leverage: number, exits?: Action["exits"]): number {
    this.cash -= fee; this.fees += fee;
    const p = this.positions.get(meta.id);
    if (!p || p.qty === 0) {
      if (meta.kind !== "perp") this.cash -= signedQty * price;
      this.positions.set(meta.id, { instrument: meta.id, kind: meta.kind, qty: signedQty, avgEntry: price, leverage, openedAt: t, peak: price, trough: price, actionId, exits, realizedUsd: 0 });
      return 0;
    }
    if (Math.sign(signedQty) === Math.sign(p.qty)) { // add
      const q = p.qty + signedQty; p.avgEntry = (p.avgEntry * p.qty + price * signedQty) / q; p.qty = q;
      if (meta.kind !== "perp") this.cash -= signedQty * price;
      if (exits) p.exits = exits;
      return 0;
    }
    const closeQty = Math.min(Math.abs(signedQty), Math.abs(p.qty)) * Math.sign(signedQty);
    const realized = -closeQty * (price - p.avgEntry);
    if (meta.kind !== "perp") this.cash += -closeQty * price; else this.cash += realized;
    p.qty += closeQty; p.realizedUsd += realized; this.realized += realized;
    if (Math.abs(p.qty) < 1e-12) this.positions.delete(meta.id);
    const rest = signedQty - closeQty;
    if (Math.abs(rest) > 1e-12) this.apply(meta, rest, price, 0, t, actionId, leverage, exits);
    return realized;
  }
}
