import { toSignalSource } from "../venues/market";
import type { RunEvent } from "../../contracts/src/events";
import type { Action, Strategy } from "../../contracts/src/strategy";
import { initState, step, type EngineState } from "../engine/engine";
import { buildSnapshot, type Snapshot } from "../engine/snapshot";
import { dec, usd } from "../lib/dec";
import { iso } from "../lib/clock";
import { newId } from "../lib/ids";
import { VenueError, type Adapters } from "../venues/adapters";
import type { MarketData } from "../venues/market";
import type { InstrumentMeta, Registry } from "../venues/registry";
import { actionTitle } from "./titles";
import { PaperAccount } from "./account";
import { gate, inTradingHours } from "./risk";

type Dist<T> = T extends unknown ? Omit<T, "v" | "seq" | "runId" | "mode" | "ts"> : never;
export type EventBody = Dist<RunEvent>;
export type Emit = (e: EventBody, t: number) => void;

export interface ExecutorDeps {
  strategy: Strategy; mkt: MarketData; adapters: Adapters; registry: Registry;
  startingEquity: number; stockTokensAllowed: () => boolean; killSwitch: () => boolean;
  /** "quote": paper fill from a real (unsent) quote + latency penalty. "next_bar": backtest, fill at next bar open with impact model. */
  fillModel: "quote" | "next_bar"; feeModel?: "default" | "zero";
  sessionKey?: () => { perTxCapUsd: number; dailyCapUsd: number; spentTodayUsd: number; status: string } | null;
  onSpend?: (usd: number) => void;
  /** M3.6: true once the run is stopping; an in-flight cycle bails out at the next await boundary. */
  aborted?: () => boolean;
  emit: Emit;
  /** M4.2 approval-required mode (confirm_each): opening orders wait as proposals for ttlMs. */
  approval?: { ttlMs: number; maxPending: number };
  /** Run-scoped approval store (outlives the live executor so stopped runs keep their history). */
  approvals?: Map<string, ApprovalRec>;
  /** M4.2.1: current run status (paused/halted runs refuse new exposure in the risk gate) */
  runStatus?: () => string;
  /** M5.19: daily-resolution backtest — Stock Token orders decided after the close queue for the next session's open. */
  stockNextOpen?: boolean;
}
interface Order { orderId: string; action: Action; meta: InstrumentMeta; signedSide: 1 | -1; notional: number; qty?: number; t: number; reducing: boolean; exitOf?: string }
export interface ApprovalRec { id: string; orderId: string; action: Action; exitOf?: string; instrument: string; venue: string; side: "buy" | "sell" | "long" | "short"; notional: number; status: "pending" | "approved" | "rejected" | "expired" | "canceled"; createdAt: number; expiresAt: number; resolvedAt: number | null; result: { status: "filled" | "rejected" | "error"; code: string | null; message: string | null } | null }
export interface FillRec { ts: number; actionId: string; instrument: string; side: string; qty: number; price: number; feeUsd: number; realized: number; reducing: boolean }

import { isTradingDay, nyLocal } from "../venues/calendar";
import { COSTS, latencyBps, modelFill, type CostVenue } from "./costs";

export const MAX_RESOLVED_APPROVALS = 200;
export class Executor {
  st: EngineState; acct: PaperAccount; halted = false; haltReason: string | null = null;
  processed = new Set<string>(); pending: Order[] = []; fills: FillRec[] = []; costs = { spreadUsd: 0, impactUsd: 0, gasUsd: 0 }; fires: { ts: number; triggerId: string }[] = [];
  lastSnap: Snapshot = {}; approvals: Map<string, ApprovalRec>; lastTickSignals = new Map<string, string>();
  constructor(readonly d: ExecutorDeps) { this.approvals = d.approvals ?? new Map(); this.st = initState(d.strategy); this.acct = new PaperAccount(d.startingEquity); }

  mark = (id: string, t?: number) => this.d.mkt.price(id, t ?? this.now)?.value ?? null;
  private now = 0;
  equity(t: number) { this.now = t; return this.acct.equity((id) => this.mark(id, t)); }

  /** One evaluation cycle at time t. */
  async cycle(t: number, opts: { emitTick?: boolean } = {}) {
    this.now = t; const s = this.d.strategy; const mk = (id: string) => this.mark(id, t);
    this.acct.rollDay(t, mk);
    this.expireApprovals(t);
    const snap = buildSnapshot(s, this.d.mkt, t, (id) => { const p = this.acct.positions.get(id); return p && { qty: p.qty, avgEntry: p.avgEntry, mark: mk(id) }; });
    this.lastSnap = snap;
    // 1) exits on open positions (allowed even when halted: they only reduce risk)
    await this.checkExits(t);
    if (this.d.aborted?.()) return null;
    // 2) run-level risk: daily loss
    const eq = this.acct.equity(mk);
    const lossPct = this.acct.dayStartEquity > 0 ? ((this.acct.dayStartEquity - eq) / this.acct.dayStartEquity) * 100 : 0;
    if (!this.halted && lossPct >= s.risk.maxDailyLossPct) this.halt("max_daily_loss", lossPct, s.risk.maxDailyLossPct, `Daily loss reached ${lossPct.toFixed(1)}% (limit ${s.risk.maxDailyLossPct}%). New orders are paused until you resume.`, t);
    const sk = this.d.sessionKey?.();
    if (!this.halted && sk && sk.status !== "active") this.halt(sk.status === "revoked" ? "session_key_revoked" : "session_key_expired", null, null, `Session key is ${sk.status}. New orders are paused.`, t);
    // 3) pure engine step
    const r = step(s, this.st, snap, t, { blocked: this.halted });
    this.st = r.state;
    if (opts.emitTick !== false) this.d.emit(this.tickBody(snap, t, false), t);
    for (const ev of r.events) {
      if (ev.type === "trigger_met") this.d.emit({ type: "trigger_met", triggerId: ev.triggerId, forMinutes: ev.forMinutes, holdUntil: ev.holdUntil ? iso(ev.holdUntil) : null, path: ev.path }, t);
      else {
        this.fires.push({ ts: t, triggerId: ev.triggerId });
        const its = r.intents.filter((i) => i.triggerId === ev.triggerId && i.fireIndex === ev.fireIndex);
        const ids = its.map(() => newId("ord", t));
        this.d.emit({ type: "trigger_fired", triggerId: ev.triggerId, fireIndex: ev.fireIndex, actionIds: ev.actionIds, intentIds: ids }, t);
        let ok = 0, bad = 0;
        for (let i = 0; i < its.length; i++) {
          if (this.d.aborted?.()) return null;
          if (this.processed.has(its[i].idempotencyKey)) continue; this.processed.add(its[i].idempotencyKey);
          const a = s.actions.find((x) => x.id === its[i].actionId)!;
          if (await this.submit(a, ids[i], t)) ok++; else bad++;
        }
        if (ok > 0 && bad > 0) this.d.emit({ type: "warning", code: "multileg_partial", message: `Only ${ok} of ${ok + bad} legs went through. Filled legs are kept (policy: leave_and_alert).` }, t);
      }
    }
    for (const [sid, sg] of Object.entries(snap)) if (sg.stale && this.lastTickSignals.get(sid + ":stalewarn") !== "1") { this.lastTickSignals.set(sid + ":stalewarn", "1"); this.d.emit({ type: "warning", code: "signal_stale", message: `Waiting for fresh data on ${sid}; rules using it stay unknown.`, signalId: sid }, t); }
      else if (!sg.stale) this.lastTickSignals.delete(sid + ":stalewarn");
    return r;
  }

  tickBody(snap: Snapshot, t: number, full: boolean): EventBody {
    const signals = [] as Extract<RunEvent, { type: "tick" }>["signals"];
    for (const [sid, sg] of Object.entries(snap)) for (const [f, v] of Object.entries(sg.fields)) {
      const key = `${sid}.${f}`; const sv = JSON.stringify([v, sg.stale]);
      if (!full && this.lastTickSignals.get(key) === sv) continue;
      if (!full) this.lastTickSignals.set(key, sv);
      signals.push({ signalId: sid, field: f, value: typeof v === "number" ? Number(v.toPrecision(10)) : v, observedAt: iso(sg.observedAt), source: toSignalSource(sg.source), stale: sg.stale || !!sg.staleReason, ...(sg.staleReason ? { staleReason: sg.staleReason } : {}) });
    }
    return { type: "tick", cycle: this.st.cycle, signals, triggers: this.d.strategy.triggers.map((tr) => { const rt = this.st.triggers[tr.id]; return { triggerId: tr.id, state: rt.state, conditionTrue: rt.lastCond, heldForSec: rt.heldSince ? Math.max(0, (t - rt.heldSince) / 1000) : 0, cooldownUntil: rt.cooldownUntil ? iso(rt.cooldownUntil) : null, fires: rt.fires }; }) };
  }

  halt(rule: Extract<RunEvent, { type: "risk_halt" }>["rule"], observed: number | null, limit: number | null, message: string, t: number) {
    this.halted = true; this.haltReason = rule;
    this.d.emit({ type: "risk_halt", rule, observed: observed == null ? null : dec(observed, 2), limit: limit == null ? null : dec(limit, 2), flattened: false, message }, t);
  }
  resume() { this.halted = false; this.haltReason = null; this.acct.dayStartEquity = this.acct.equity((id) => this.mark(id)); }

  private async checkExits(t: number) {
    for (const p of [...this.acct.positions.values()]) {
      const x = p.exits; if (!x) continue; const m = this.mark(p.instrument, t); if (m == null) continue;
      p.peak = Math.max(p.peak, m); p.trough = Math.min(p.trough, m);
      const dir = Math.sign(p.qty); const pnlPct = ((m - p.avgEntry) / p.avgEntry) * 100 * dir;
      let why: string | null = null;
      if (x.stopLoss) why = x.stopLoss.unit === "pct" ? (pnlPct <= -Number(x.stopLoss.value) ? "stop_loss" : null) : (dir > 0 ? m <= Number(x.stopLoss.value) : m >= Number(x.stopLoss.value)) ? "stop_loss" : null;
      if (!why && x.takeProfit) why = x.takeProfit.unit === "pct" ? (pnlPct >= Number(x.takeProfit.value) ? "take_profit" : null) : (dir > 0 ? m >= Number(x.takeProfit.value) : m <= Number(x.takeProfit.value)) ? "take_profit" : null;
      if (!why && x.takeProfits?.length && pnlPct >= Number(x.takeProfits[0].atPct)) why = "take_profit";
      if (!why && x.trailingStopPct) { const ref = dir > 0 ? p.peak : p.trough; const dd = ((ref - m) / ref) * 100 * dir; if (dd >= Number(x.trailingStopPct)) why = "trailing_stop"; }
      if (!why && x.timeExitHours && t - p.openedAt >= x.timeExitHours * 3_600_000) why = "time_exit";
      if (!why) continue;
      const a = this.d.strategy.actions.find((y) => y.id === p.actionId)!;
      const key = `exit:${p.actionId}:${p.openedAt}`; if (this.processed.has(key)) continue; this.processed.add(key);
      this.d.emit({ type: "warning", code: why, message: `${why.replace("_", " ")} hit on ${this.d.registry.get(p.instrument)?.symbol} (${pnlPct.toFixed(2)}%). Closing.` }, t);
      await this.submit({ ...a, id: `${a.id}.exit`, type: "close" } as Action, newId("ord", t), t, p.actionId);
    }
  }

  /** Risk gate -> intent -> fill (or defer). Returns true if it passed the gate. */
  async submit(a: Action, orderId: string, t: number, exitOf?: string, fraction = 1, approved = false): Promise<boolean> {
    const meta = this.d.registry.get(a.instrument)!; const s = this.d.strategy; const mk = (id: string) => this.mark(id, t);
    const pos = this.acct.positions.get(a.instrument); const mark = mk(a.instrument);
    const reducing = a.type === "close";
    if (meta.venue === "polymarket") { this.reject(orderId, "venue_read_only", "Polymarket is read-only.", t); return false; }
    if (mark == null) { this.d.emit({ type: "error", code: "quote_unavailable", message: `No price for ${meta.symbol}; skipped.`, retryable: false, orderId }, t); return false; }
    if ((meta.assetClass === "equity" || meta.assetClass === "etf") && meta.venue === "robinhood") {
      const pp = this.d.mkt.price(a.instrument, t);
      // M5.19: a daily bar's decision (after the close, on a trading day) may queue for the next open; weekends/holidays still refuse.
      const dailyOk = this.d.stockNextOpen && this.d.fillModel === "next_bar" && !pp?.stale && isTradingDay(nyLocal(t).date, nyLocal(t).weekday);
      if (!dailyOk && (this.d.mkt.session(t) === "closed" || pp?.stale)) { this.reject(orderId, "market_closed", `${meta.symbol}: the stock market is closed and its price feed is paused; no orders are placed until it reopens.`, t); return false; }
    }
    if (reducing && (!pos || pos.qty === 0)) { this.reject(orderId, "no_position", `No open ${meta.symbol} position to close.`, t); return false; }
    const eq = this.acct.equity(mk);
    let margin: number, notional: number, signedSide: 1 | -1, qty: number | undefined;
    if (reducing) { signedSide = pos!.qty > 0 ? -1 : 1; qty = Math.abs(pos!.qty) * Math.min(1, Math.max(0, fraction)); notional = qty * mark; margin = 0; }
    else {
      signedSide = a.side === "buy" || a.side === "long" ? 1 : -1;
      const v = Number(a.size.value);
      margin = a.size.unit === "usd" ? v : a.size.unit === "pct_equity" ? (eq * v) / 100 : (v * mark) / (meta.kind === "perp" ? a.leverage : 1);
      notional = meta.kind === "perp" ? margin * a.leverage : margin;
    }
    const curPos = pos ? Math.abs(pos.qty) * mark / (pos.kind === "perp" ? pos.leverage : 1) : 0;
    const sk = this.d.sessionKey?.();
    const rs = this.d.runStatus?.();
    const g = gate({
      runState: this.halted || rs === "halted" ? "halted" : rs === "paused" ? "paused" : "active",
      killSwitch: this.d.killSwitch(), stockTokensAllowed: this.d.stockTokensAllowed(), isEquity: meta.assetClass === "equity" || meta.assetClass === "etf", reducing,
      tradingHoursOk: inTradingHours(s.risk, t), ordersToday: this.acct.ordersToday, maxOrdersPerDay: s.risk.maxOrdersPerDay,
      positionUsdAfter: curPos + margin, equity: eq, maxPositionPct: s.risk.maxPositionPct,
      exposureAfter: this.acct.exposure(mk) + notional, maxTotalExposurePct: s.risk.maxTotalExposurePct,
      cashNeeded: margin * 1.01, freeCash: this.acct.freeCash(),
      sessionKey: sk && meta.venue === "robinhood" ? { ...sk, notional } : null,
    });
    if (g) { this.reject(orderId, g.code, g.message, t); return false; }
    if (this.d.approval && !reducing && !approved) { // M4.2: propose instead of placing
      if ([...this.approvals.values()].filter((x) => x.status === "pending").length >= this.d.approval.maxPending) { this.reject(orderId, "approval_queue_full", `Too many trades waiting for approval (max ${this.d.approval.maxPending}).`, t); return false; }
      const rec: ApprovalRec = { id: newId("apv", t), orderId, action: a, exitOf, instrument: a.instrument, venue: meta.venue, side: a.side as ApprovalRec["side"], notional, status: "pending", createdAt: t, expiresAt: t + this.d.approval.ttlMs, resolvedAt: null, result: null };
      this.approvals.set(rec.id, rec);
      this.d.emit({ type: "approval_requested", approvalId: rec.id, orderId, actionId: a.id, strategyName: this.d.strategy.name, actionTitle: actionTitle(rec, this.d.registry), instrument: a.instrument, venue: meta.venue, side: rec.side, notionalUsd: usd(notional), expiresAt: iso(rec.expiresAt) }, t);
      return true;
    }
    this.acct.ordersToday++;
    this.d.emit({ type: "intent", orderId, actionId: a.id, instrument: a.instrument, venue: meta.venue, side: reducing ? (signedSide > 0 ? (meta.kind === "perp" ? "long" : "buy") : meta.kind === "perp" ? "short" : "sell") : a.side, notionalUsd: usd(notional), maxSlippageBps: a.order.maxSlippageBps }, t);
    const o: Order = { orderId, action: a, meta, signedSide, notional, qty, t, reducing, exitOf };
    if (this.d.fillModel === "next_bar") { this.pending.push(o); return true; }
    await this.fillFromQuote(o, t);
    return true;
  }
  private reject(orderId: string, code: string, message: string, t: number) { this.d.emit({ type: "rejected", orderId, code, message }, t); }

  private async fillFromQuote(o: Order, t: number) {
    const ad = this.d.adapters[o.meta.venue];
    let q;
    try { q = await ad.quote(o.meta.id, o.signedSide > 0 ? "buy" : "sell", o.notional, t); }
    catch (e) {
      if (e instanceof VenueError) { this.d.emit({ type: "error", code: e.code, message: e.message, retryable: false, orderId: o.orderId }, t); return; }
      throw e;
    }
    const ref = q.referencePrice ?? q.price;
    const lat = COSTS[o.meta.venue as CostVenue]?.latencyMs ?? 1000;
    const latBps = latencyBps(o.meta.venue as CostVenue, ref, this.d.mkt.price(o.meta.id, t - lat)?.value ?? null);
    const price = q.price * (1 + (o.signedSide * latBps) / 10_000);
    const slip = ((price - ref) / ref) * 10_000 * o.signedSide;
    if (!o.reducing && q.priceImpactBps > o.action.order.maxPriceImpactBps) { this.reject(o.orderId, "price_impact_exceeded", `Price impact ${q.priceImpactBps.toFixed(1)} bps is above the ${o.action.order.maxPriceImpactBps} bps limit.`, t); return; }
    if (!o.reducing && slip > o.action.order.maxSlippageBps) { this.reject(o.orderId, "slippage_exceeded", `Slippage ${slip.toFixed(1)} bps is above the ${o.action.order.maxSlippageBps} bps limit.`, t); return; }
    if (o.action.order.type === "limit" && o.action.order.limitPrice && !o.reducing && (o.signedSide > 0 ? price > Number(o.action.order.limitPrice) : price < Number(o.action.order.limitPrice))) { this.reject(o.orderId, "limit_not_marketable", "Limit price not reached.", t); return; }
    const fee = this.d.feeModel === "zero" ? 0 : q.feeUsd + (q.gasUsd ?? 0);
    this.doFill(o, price, fee, ref, q.referenceSource ?? "venue_mid", slip, t);
  }

  /** Backtest: settle deferred orders at the next bar's open (time t) using the impact model. */
  settlePending(t: number) {
    const ps = this.pending; this.pending = [];
    for (const o of ps) {
      if (this.d.stockNextOpen && o.meta.venue === "robinhood" && (o.meta.assetClass === "equity" || o.meta.assetClass === "etf")) {
        const at = this.nextOpen(t); if (at == null) { this.reject(o.orderId, "market_closed", `${o.meta.symbol}: no market open found after the order; it was not placed.`, t); continue; }
        this.awaitingOpen.push({ o, at }); continue;
      }
      const pp = this.d.mkt.price(o.meta.id, t); const open = pp?.value;
      // M3.4.1: Stock Tokens fill only if the session is active at the fill time itself (sessions are [start, end) in ET,
      // so a bar opening exactly at 20:00 ET / 17:00 ET early close / a holiday is closed). Same rule as order placement: reject, no deferral.
      if (o.meta.venue === "robinhood" && (o.meta.assetClass === "equity" || o.meta.assetClass === "etf") && (this.d.mkt.session(t) === "closed" || pp?.stale)) {
        this.reject(o.orderId, "market_closed", `${o.meta.symbol}: the stock market closed before the order could fill; it was not placed.`, t); continue;
      }
      if (open == null) { this.d.emit({ type: "error", code: "quote_unavailable", message: "No next-bar price.", retryable: false, orderId: o.orderId }, t); continue; }
      const eq = o.meta.assetClass === "equity" || o.meta.assetClass === "etf";
      const c = modelFill({ venue: o.meta.venue as CostVenue, ref: open, side: o.signedSide, notional: o.notional, depthUsd: o.meta.depthUsd, isEquity: eq, session: eq ? this.d.mkt.session(t) : "always", feeModel: this.d.feeModel });
      this.costs.spreadUsd += (o.notional * c.spreadBps) / 1e4; this.costs.impactUsd += (o.notional * c.impactBps) / 1e4; this.costs.gasUsd += c.gasUsd;
      this.doFill(o, c.price, c.feeUsd + c.gasUsd, open, "model", c.slippageBps, t);
    }
  }

  /** M5.19: orders queued for the next regular-session open (daily stock backtests). */
  awaitingOpen: { o: Order; at: number }[] = [];
  /** First regular-session ("open") instant at or after t, scanning 15-min steps up to 10 days (skips nights, weekends, holidays). */
  private nextOpen(t: number): number | null {
    let x = Math.ceil(t / 900_000) * 900_000;
    for (let k = 0; k < 960; k++, x += 900_000) if (this.d.mkt.session(x) === "open") return x;
    return null;
  }
  /** M5.19: fill queued orders whose open has passed, at the open of the first bar with data at/after it (`now` = latest
   * known time; a bar that has not finished by `now` is never read, so no look-ahead). Unfilled ones stay queued. */
  settleAtOpen(now: number) {
    const keep: { o: Order; at: number }[] = [];
    for (const q of this.awaitingOpen) {
      if (q.at > now) { keep.push(q); continue; }
      const op = this.d.mkt.openAt ? this.d.mkt.openAt(q.o.meta.id, q.at, now) : (() => { const p = this.d.mkt.price(q.o.meta.id, q.at); return p ? { value: p.value, t: q.at } : null; })();
      if (!op) { keep.push(q); continue; } // no bar with data yet (gap) → wait for the next one
      const c = modelFill({ venue: q.o.meta.venue as CostVenue, ref: op.value, side: q.o.signedSide, notional: q.o.notional, depthUsd: q.o.meta.depthUsd, isEquity: true, session: "open", feeModel: this.d.feeModel });
      this.costs.spreadUsd += (q.o.notional * c.spreadBps) / 1e4; this.costs.impactUsd += (q.o.notional * c.impactBps) / 1e4; this.costs.gasUsd += c.gasUsd;
      this.doFill(q.o, c.price, c.feeUsd + c.gasUsd, op.value, "model", c.slippageBps, op.t);
    }
    this.awaitingOpen = keep;
  }

  /** M4.9.2: after a timed-out stop_and_flatten the run is closed; any fill that resolves later is blocked, never applied silently. */
  private frozen = false; blockedFills = 0;
  freeze() { this.frozen = true; this.pending = []; this.awaitingOpen = []; }
  private doFill(o: Order, price: number, fee: number, ref: number, refSrc: string, slip: number, t: number) {
    if (this.frozen) { this.blockedFills++; return; }
    const qty = o.qty ?? o.notional / price;
    const realized = this.acct.apply(o.meta, o.signedSide * qty, price, fee, t, o.exitOf ?? o.action.id, o.action.leverage, o.action.exits);
    this.d.onSpend?.(o.notional);
    const p = this.acct.positions.get(o.meta.id);
    const side = this.sideOf(o);
    this.fills.push({ ts: t, actionId: o.action.id, instrument: o.meta.id, side, qty, price, feeUsd: fee, realized, reducing: o.reducing });
    this.d.emit({ type: "fill", fillId: newId("fil", t), orderId: o.orderId, actionId: o.action.id, instrument: o.meta.id, venue: o.meta.venue, side, qty: dec(qty, 8), price: dec(price, 6), notionalUsd: usd(qty * price), feeUsd: usd(fee), slippageBps: Number(slip.toFixed(2)), referencePrice: dec(ref, 6), referenceSource: refSrc, simulated: true, txHash: null, explorerUrl: null,
      position: { qty: dec(p?.qty ?? 0, 8), avgEntry: dec(p?.avgEntry ?? 0, 6), unrealizedPnlUsd: usd(p ? p.qty * ((this.mark(o.meta.id, t) ?? price) - p.avgEntry) : 0) } }, t);
  }
  private sideOf(o: Order): "buy" | "sell" | "long" | "short" { return o.meta.kind === "perp" ? (o.signedSide > 0 ? "long" : "short") : o.signedSide > 0 ? "buy" : "sell"; }

  /** M4.1: market-close `fraction` (0..1] of one position (user partial close, paper). Same risk/market-hours path as exits. */
  async closePartial(instrument: string, fraction: number, orderId: string, t: number): Promise<boolean> {
    const p = this.acct.positions.get(instrument); if (!p) return false;
    const a = this.d.strategy.actions.find((y) => y.id === p.actionId)!;
    const ok = await this.submit({ ...a, id: `${a.id}.partial`, type: "close" } as Action, orderId, t, p.actionId, fraction);
    if (this.d.fillModel === "next_bar") this.settlePending(t);
    return ok;
  }
  /** M5.3: paper write-off of a stuck position at zero recovery. Spot: the cost basis is lost; perp: the posted margin is lost.
   * Drops any pending order for the instrument so nothing re-opens it. Returns null if there is no position. */
  writeOff(instrument: string, t: number): { qty: number; avgEntry: number; lossUsd: number; kind: string } | null {
    const p = this.acct.positions.get(instrument); if (!p || p.qty === 0) return null;
    const loss = p.kind === "perp" ? (Math.abs(p.qty) * p.avgEntry) / p.leverage : Math.max(0, p.qty * p.avgEntry);
    if (p.kind === "perp") this.acct.cash -= loss; // spot cost was already paid from cash
    this.acct.realized -= loss; p.realizedUsd -= loss; this.acct.positions.delete(instrument);
    this.pending = this.pending.filter((o) => o.meta.id !== instrument); this.awaitingOpen = this.awaitingOpen.filter((q) => q.o.meta.id !== instrument);
    void t; return { qty: p.qty, avgEntry: p.avgEntry, lossUsd: loss, kind: p.kind };
  }
  /** M4.2: expire pending proposals whose TTL has passed. */
  expireApprovals(t: number) { for (const r of this.approvals.values()) if (r.status === "pending" && r.expiresAt <= t) this.resolve(r, "expired", t); }
  cancelApprovals(t: number) { for (const r of this.approvals.values()) if (r.status === "pending") this.resolve(r, "canceled", t); }
  private resolve(r: ApprovalRec, d: "approved" | "rejected" | "expired" | "canceled", t: number) { r.status = d; r.resolvedAt = t; this.d.emit({ type: "approval_resolved", approvalId: r.id, orderId: r.orderId, decision: d }, t); this.pruneResolved(); }
  /** M4.2.1: keep at most MAX_RESOLVED_APPROVALS resolved records per run (oldest resolved dropped first; pending never pruned). */
  private pruneResolved() {
    const done = [...this.approvals.values()].filter((x) => x.status !== "pending"); if (done.length <= MAX_RESOLVED_APPROVALS) return;
    done.sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0)); for (const x of done.slice(0, done.length - MAX_RESOLVED_APPROVALS)) this.approvals.delete(x.id);
  }
  /** Approve or reject a pending proposal. Approve re-runs the full risk gate + pricing at time t. */
  async decide(id: string, decision: "approve" | "reject", t: number): Promise<"ok" | "not_pending"> {
    const r = this.approvals.get(id); this.expireApprovals(t); if (!r || r.status !== "pending") return "not_pending";
    if (decision === "reject") { this.resolve(r, "rejected", t); return "ok"; }
    this.resolve(r, "approved", t); await this.submit(r.action, r.orderId, t, r.exitOf, 1, true);
    return "ok";
  }
  /** Market-close every position (stop_and_flatten). */
  async flatten(t: number) {
    for (const p of [...this.acct.positions.values()]) {
      const a = this.d.strategy.actions.find((y) => y.id === p.actionId)!;
      await this.submit({ ...a, id: `${a.id}.exit`, type: "close" } as Action, newId("ord", t), t, p.actionId);
    }
    if (this.d.fillModel === "next_bar") this.settlePending(t);
  }
}
