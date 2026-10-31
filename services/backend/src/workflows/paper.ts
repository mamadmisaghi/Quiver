import { z } from "zod";
import { type Workflow, type PlanExpr, type PlanStage, expressionRefs, workflowProblems, workflowBlockers } from "../../contracts/src/workflow";
import { Risk } from "../../contracts/src/strategy";
import { TF_MS, sma, ema, rsi, bb, pctChange } from "../engine/indicators";
import { cronMatches } from "../engine/cron";

export const PaperQuote = z.object({ assetId: z.string().max(32), price: z.number().finite().nonnegative(), observedAt: z.number().finite(), source: z.string().max(80), synthetic: z.boolean(), fundingHourly: z.number().optional(), settled: z.boolean().optional(), payout: z.union([z.literal(0), z.literal(1)]).optional() });
export type PaperQuote = z.infer<typeof PaperQuote>;
type Allocation = { source: string; value: number };
type Position = { assetId: string; qty: number; baseQty: number; entry: number; margin: number; entryFee: number; side: 1 | -1; leverage: number; openedAt: number; peakPct: number; rungs: number[]; allocation: Allocation[] };
type StageState = { fills: number; lastFillAt: number | null; active: boolean; latched: boolean; closed: boolean; resolved: boolean; realized: number; status: string; consumedDependency?: string };
export type PaperState = { version: 1; startedAt: number; lastAt: number; budget: number; principal: number; pools: Record<string, number>; positions: Record<string, Position>; stages: Record<string, StageState>; anchors: Record<string, number>; history: Record<string, [number, number][]>; previous: Record<string, number | boolean | null>; quotes: Record<string, PaperQuote>; fees: number; realized: number; day: string; dayStart: number; dayOrders: number; events: { at: number; stageId: string; kind: "buy" | "sell" | "exit" | "settle"; amount: number; price: number; fee: number; detail: string }[]; curve: [number, number][] };
const EPS = 1e-8, feeRate = .001;
export function paperProblems(w: Workflow, live = false) {
  const errors = [...workflowProblems(w), ...workflowBlockers(w).filter((x) => live || !w.assets.some((a) => x === a.resolution?.message || x === `Choose the exact market for ${a.query}.`))];
  if (!w.budgetUsd) errors.push("Set a strategy budget to test.");
  for (const s of w.signals) {
    if (s.kind === "custom") errors.push(`Refine the unsupported condition: ${s.description}`);
    if (s.indicator?.name === "atr") errors.push("ATR needs OHLC bars; quote-only paper tests cannot evaluate it.");
  }
  for (const s of w.stages) if (s.exits.description) errors.push(`Refine the additional exit rule on ${s.id}: ${s.exits.description}`);
  return [...new Set(errors)];
}
export function createPaper(w: Workflow, at = Date.now()): PaperState {
  const problems = paperProblems(w); if (problems.length) throw new Error(problems[0]);
  return { version: 1, startedAt: at, lastAt: at - 1, budget: w.budgetUsd!, principal: w.budgetUsd!, pools: {}, positions: {}, stages: Object.fromEntries(w.stages.map((s) => [s.id, { fills: 0, lastFillAt: null, active: false, latched: false, closed: false, resolved: false, realized: 0, status: "Waiting for condition" }])), anchors: {}, history: {}, previous: {}, quotes: {}, fees: 0, realized: 0, day: "", dayStart: w.budgetUsd!, dayOrders: 0, events: [], curve: [] };
}
export const freeCash = (s: PaperState) => s.principal + Object.values(s.pools).reduce((a, b) => a + b, 0);
export function paperEquity(s: PaperState) {
  return freeCash(s) + Object.values(s.positions).reduce((sum, p) => sum + Math.max(0, p.margin + p.qty * ((s.quotes[p.assetId]?.price ?? p.entry) - p.entry) * p.side), 0);
}
const fresh = (q: PaperQuote | undefined, at: number) => q && q.observedAt <= at + 5000 && at - q.observedAt <= 120_000;
const addCash = (s: PaperState, a: Allocation, value: number) => { if (a.source === "budget") s.principal += value; else s.pools[a.source] = (s.pools[a.source] ?? 0) + value; };
function takeCash(s: PaperState, stage: PlanStage, value: number): Allocation[] | null {
  const sources = stage.funding.kind === "budget" ? ["budget"] : [...new Set(stage.funding.from)];
  const available = (id: string) => id === "budget" ? s.principal : s.pools[id] ?? 0;
  if (sources.reduce((n, id) => n + available(id), 0) + EPS < value) return null;
  let left = value; const out: Allocation[] = [];
  for (const id of sources) { const n = Math.min(left, available(id)); if (n > 0) { addCash(s, { source: id, value: n }, -n); out.push({ source: id, value: n }); left -= n; } }
  return out;
}
function exitPosition(s: PaperState, id: string, at: number, price: number, quantity: number, kind: "exit" | "settle", reason: string) {
  const p = s.positions[id]; if (!p || !(quantity > 0)) return;
  const qty = Math.min(p.qty, quantity), fraction = qty / p.qty, margin = p.margin * fraction, entryFee = p.entryFee * fraction;
  const fee = kind === "settle" ? 0 : qty * price * feeRate;
  // Isolated paper margin: a loss cannot take more than this position's collateral.
  const proceeds = Math.max(0, margin + qty * (price - p.entry) * p.side - fee);
  const net = proceeds - margin - entryFee, principalReturn = net > 0 ? margin + entryFee : proceeds;
  const allocationTotal = p.allocation.reduce((n, a) => n + a.value, 0);
  for (const a of p.allocation) addCash(s, a, allocationTotal ? principalReturn * a.value / allocationTotal : 0);
  if (net > 0) s.pools[id] = (s.pools[id] ?? 0) + net;
  s.fees += fee; s.realized += net; s.stages[id].realized += net;
  s.events.push({ at, stageId: id, kind, amount: qty * price, price, fee, detail: reason }); s.dayOrders++;
  p.margin -= margin; p.entryFee -= entryFee; p.qty -= qty; p.allocation = p.allocation.map((a) => ({ ...a, value: a.value * (1 - fraction) }));
  if (p.qty <= EPS * Math.max(1, p.baseQty)) { delete s.positions[id]; s.stages[id].closed = true; s.stages[id].resolved = kind === "settle"; }
}
function evaluate(e: PlanExpr, value: (ref: string) => number | boolean | null, previous: Record<string, number | boolean | null>): boolean | null {
  if ("args" in e) { const a = e.args.map((v) => evaluate(v, value, previous)); return e.op === "and" ? a.includes(false) ? false : a.includes(null) ? null : true : a.includes(true) ? true : a.includes(null) ? null : false; }
  if ("arg" in e) { const v = evaluate(e.arg, value, previous); return v === null ? null : !v; }
  const get = (o: typeof e.left, old = false): number | string | boolean | null => "lit" in o ? o.lit : old ? previous[o.ref] ?? null : value(o.ref);
  const l = get(e.left), r = get(e.right); if (l === null || r === null) return null;
  if (e.op === "eq") return l === r; if (e.op === "neq") return l !== r;
  if (typeof l !== "number" || typeof r !== "number") return null;
  if (e.op === "lt") return l < r; if (e.op === "lte") return l <= r; if (e.op === "gt") return l > r; if (e.op === "gte") return l >= r;
  const pl = get(e.left, true), pr = get(e.right, true); if (typeof pl !== "number" || typeof pr !== "number") return false;
  return e.op === "crosses_above" ? pl <= pr && l > r : pl >= pr && l < r;
}
/** Pure, checkpointable paper execution. The same evaluator can be driven by a browser or a server worker. */
export function stepPaper(w: Workflow, state: PaperState, incoming: PaperQuote[], at: number, risk = Risk.parse({})): PaperState {
  const s = structuredClone(state); if (at <= s.lastAt) return s; s.lastAt = at;
  for (const q of incoming) if (w.assets.some((a) => a.id === q.assetId) && fresh(q, at) && (q.price > 0 || q.settled)) {
    s.quotes[q.assetId] = q; const h = s.history[q.assetId] ?? [];
    if (!h.length || h.at(-1)![0] < q.observedAt) h.push([q.observedAt, q.price]); s.history[q.assetId] = h.slice(-2400);
  }
  const equity = paperEquity(s), day = new Date(at).toISOString().slice(0, 10);
  if (day !== s.day) { s.day = day; s.dayStart = equity; s.dayOrders = 0; }
  const values: Record<string, number | boolean | null> = {};
  for (const signal of w.signals) {
    const q = signal.assetId ? s.quotes[signal.assetId] : undefined, h = signal.assetId ? s.history[signal.assetId] ?? [] : [];
    let v: number | boolean | null = null;
    if (signal.kind === "timer" && signal.schedule) { try { v = cronMatches(signal.schedule.cron, signal.schedule.tz, at); } catch {} }
    else if (fresh(q, at)) {
      if (signal.kind === "price" || signal.kind === "odds") v = q!.price;
      else if (signal.kind === "funding") v = q!.fundingHourly ?? null;
      else if (signal.kind === "drawdown" && signal.drawdown && signal.drawdown.reference !== "needs_choice") {
        const d = signal.drawdown;
        if (!(signal.id in s.anchors)) s.anchors[signal.id] = q!.price;
        if (d.reference === "peak") s.anchors[signal.id] = Math.max(s.anchors[signal.id], q!.price);
        const reference = d.reference === "lookback" ? h.find(([t]) => t >= at - (d.lookbackMinutes ?? 0) * 60_000)?.[1] : s.anchors[signal.id];
        // Lookback signals require the whole requested window; never invent missing history.
        if (reference && (d.reference !== "lookback" || (h[0]?.[0] ?? at) <= at - (d.lookbackMinutes ?? 0) * 60_000)) v = Math.max(0, (1 - q!.price / reference) * 100);
      } else if (signal.kind === "indicator" && signal.indicator) {
        const { name, period, timeframe } = signal.indicator, buckets = new Map<number, number>();
        for (const [t, price] of h) { const end = (Math.floor(t / TF_MS[timeframe]) + 1) * TF_MS[timeframe]; if (end <= at) buckets.set(end, price); }
        const c = [...buckets.values()];
        v = name === "sma" ? sma(c, period) : name === "ema" ? ema(c, period) : name === "rsi" ? rsi(c, period) : name === "bb_upper" ? bb(c, period, 1) : name === "bb_lower" ? bb(c, period, -1) : name === "pct_change" ? pctChange(c, period) : null;
      } else if (signal.kind === "position") {
        const p = Object.values(s.positions).filter((p) => p.assetId === signal.assetId), qty = p.reduce((n, x) => n + x.qty * x.side, 0);
        values[signal.id + ".qty"] = qty; values[signal.id + ".value_usd"] = qty * q!.price;
        const margin = p.reduce((n, x) => n + x.margin, 0), pnl = p.reduce((n, x) => n + x.qty * (q!.price - x.entry) * x.side, 0); values[signal.id + ".pnl_pct"] = margin ? pnl / margin * 100 : 0; v = qty;
      }
    }
    values[signal.id + ".value"] = v;
  }
  // Exits happen before downstream dependencies. Unrealized gains never create profit pools.
  for (const stage of w.stages) {
    const p = s.positions[stage.id], q = s.quotes[stage.assetId]; if (!p || !fresh(q, at)) continue;
    const pct = (q.price / p.entry - 1) * p.side * 100, x = stage.exits; p.peakPct = Math.max(p.peakPct, pct);
    if (q.settled && q.payout !== undefined) exitPosition(s, stage.id, at, q.payout, p.qty, "settle", "Outcome settled; proceeds are now available.");
    else if (pct <= -100 / p.leverage || (x.stopLossPct && pct <= -x.stopLossPct) || (x.takeProfitPct && pct >= x.takeProfitPct) || (x.trailingStopPct && p.peakPct - pct >= x.trailingStopPct) || (x.timeExitHours && at - p.openedAt >= x.timeExitHours * 3_600_000)) exitPosition(s, stage.id, at, q.price, p.qty, "exit", "Position exit condition met.");
    else for (let i = 0; i < x.ladder.length; i++) if (s.positions[stage.id] && !p.rungs.includes(i) && pct >= x.ladder[i].atPct) { p.rungs.push(i); exitPosition(s, stage.id, at, q.price, p.baseQty * x.ladder[i].fraction, "exit", `Take-profit rung ${i + 1}; fraction of original position.`); }
  }
  for (const stage of w.stages) {
    const st = s.stages[stage.id], q = s.quotes[stage.assetId];
    if (!fresh(q, at) || !q || q.price <= 0 || q.settled) { st.status = "Waiting for fresh market data"; continue; }
    const dependencies = stage.after.every((d) => { const prev = s.stages[d.stageId]; return prev && (d.event === "filled" ? prev.fills > 0 : d.event === "closed" ? prev.closed : d.event === "resolved_profit" ? prev.resolved && (s.pools[d.stageId] ?? 0) > EPS : prev.realized > EPS && (s.pools[d.stageId] ?? 0) > EPS); });
    if (!dependencies) { st.status = "Waiting for predecessor / realized profit"; continue; }
    const yes = stage.when ? evaluate(stage.when, (ref) => values[ref] ?? null, s.previous) : true;
    const was = st.active; if (yes !== null) st.active = yes;
    if (yes) st.latched = true;
    const r = stage.repeat;
    if ((!r && st.fills > 0) || (r?.maxTimes && st.fills >= r.maxTimes)) { st.status = "Completed"; continue; }
    if (r?.intervalMinutes && st.lastFillAt !== null && at - st.lastFillAt < r.intervalMinutes * 60_000) { st.status = "Waiting for interval"; continue; }
    const drop = w.signals.filter((sig) => expressionRefs(stage.when).has(sig.id) && sig.kind === "drawdown" && (sig.drawdown?.reference === "peak" || sig.drawdown?.reference === "last_fill") && sig.assetId === stage.assetId);
    const dependencyStamp = stage.after.map((d) => `${d.stageId}:${d.event}:${s.stages[d.stageId]?.fills}:${s.stages[d.stageId]?.realized}:${s.stages[d.stageId]?.resolved}`).join("|");
    if (r && !r.intervalMinutes && st.fills && !drop.length && (stage.after.length ? st.consumedDependency === dependencyStamp : was)) { st.status = "Waiting for a new condition event"; continue; }
    if (!(yes === true || (r?.conditionMode === "once_then_repeat" && st.latched))) { st.status = yes === null ? "Waiting for signal history / data" : "Waiting for condition"; continue; }
    if (s.dayOrders >= risk.maxOrdersPerDay || paperEquity(s) < s.dayStart * (1 - risk.maxDailyLossPct / 100)) { st.status = "Paused by daily risk limit"; continue; }
    if (risk.tradingHours) { const h = risk.tradingHours; const date = new Intl.DateTimeFormat("en-US", { timeZone: h.tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(new Date(at)); const time = `${date.find((p) => p.type === "hour")?.value}:${date.find((p) => p.type === "minute")?.value}`, dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(date.find((p) => p.type === "weekday")?.value ?? ""); const inside = h.from < h.to ? time >= h.from && time < h.to : time >= h.from || time < h.to; if (!inside || !h.days.includes((["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const)[dow])) { st.status = "Outside allowed trading hours"; continue; } }
    const amount = stage.amount.value!; const available = stage.funding.kind === "budget" ? s.principal : stage.funding.from.reduce((n, id) => n + (s.pools[id] ?? 0), 0);
    const usd = stage.amount.unit === "usd" ? amount : stage.amount.unit === "native" ? amount * q.price / stage.leverage : stage.amount.unit === "pct_equity" ? paperEquity(s) * amount / 100 : stage.amount.unit === "pct_profits" ? available * amount / 100 : 0;
    if (stage.side === "sell" || stage.amount.unit === "pct_position") {
      const positions = Object.entries(s.positions).filter(([, p]) => p.assetId === stage.assetId && p.side === 1);
      if (!positions.length) { st.status = "Waiting for a position to reduce"; continue; }
      let left = stage.amount.unit === "pct_position" ? positions.reduce((n, [, p]) => n + p.qty, 0) * amount / 100 : stage.amount.unit === "native" ? amount : usd / q.price;
      for (const [id, p] of positions) { const n = Math.min(left, p.qty), before = s.realized, oldPool = s.pools[id] ?? 0; exitPosition(s, id, at, q.price, n, "exit", `Reduced by stage ${stage.id}`); if (id !== stage.id) { st.realized += s.realized - before; const earned = Math.max(0, (s.pools[id] ?? 0) - oldPool); s.pools[id] = (s.pools[id] ?? 0) - earned; s.pools[stage.id] = (s.pools[stage.id] ?? 0) + earned; } left -= n; if (left <= EPS) break; }
      st.fills++; st.lastFillAt = at; st.closed = true; st.consumedDependency = dependencyStamp; st.status = "Reduced position"; continue;
    }
    if (available + EPS < usd + usd * stage.leverage * feeRate) { st.status = stage.funding.kind === "profits" ? "Waiting for enough realized profit" : "Budget cannot cover the next full order and fees"; continue; }
    const existing = s.positions[stage.id]; const exposure = Object.values(s.positions).reduce((n, p) => n + p.qty * (s.quotes[p.assetId]?.price ?? p.entry), 0), eq = paperEquity(s);
    if (!(usd > 0) || usd * stage.leverage + (existing?.qty ?? 0) * q.price > eq * risk.maxPositionPct / 100 + EPS || exposure + usd * stage.leverage > eq * risk.maxTotalExposurePct / 100 + EPS) { st.status = "Order blocked by exposure limit"; continue; }
    const fee = usd * stage.leverage * feeRate, allocation = takeCash(s, stage, usd + fee);
    if (!allocation) { st.status = stage.funding.kind === "profits" ? "Waiting for enough realized profit" : "Budget cannot cover the next full order and fees"; continue; }
    const qty = usd * stage.leverage / q.price;
    const p: Position = existing ?? { assetId: stage.assetId, qty: 0, baseQty: 0, entry: q.price, margin: 0, entryFee: 0, side: stage.side === "short" ? -1 : 1, leverage: stage.leverage, openedAt: at, peakPct: 0, rungs: [], allocation: [] };
    p.entry = (p.entry * p.qty + q.price * qty) / (p.qty + qty); p.qty += qty; p.baseQty += qty; p.margin += usd; p.entryFee += fee; p.allocation.push(...allocation); s.positions[stage.id] = p;
    s.fees += fee; s.dayOrders++; st.fills++; st.lastFillAt = at; st.closed = false; st.resolved = false; st.consumedDependency = dependencyStamp; st.status = "Paper order filled";
    for (const sig of drop) { s.anchors[sig.id] = q.price; values[sig.id + ".value"] = 0; } if (drop.length) st.active = false;
    s.events.push({ at, stageId: stage.id, kind: "buy", amount: usd, price: q.price, fee, detail: `${stage.side} ${w.assets.find((a) => a.id === stage.assetId)?.query}; ${stage.leverage}x; ${stage.funding.kind} funding` });
  }
  s.previous = values; s.events = s.events.slice(-300); s.curve.push([at, paperEquity(s)]); s.curve = s.curve.slice(-1000); return s;
}
/** Explicit scenario data, never historical performance or a prediction. */
export function syntheticFrames(w: Workflow, count = 120, start = Date.now(), seeds: Record<string, number> = {}) {
  const step = Math.max(60_000, ...w.signals.map((sig) => sig.indicator ? TF_MS[sig.indicator.timeframe] : 60_000));
  const at = start - count * step, frames: { at: number; quotes: PaperQuote[] }[] = [];
  for (let i = 0; i < count; i++) {
    const time = at + i * step;
    frames.push({ at: time, quotes: w.assets.map((a, j) => {
      let seed = seeds[a.id] ?? (a.kind === "outcome" ? .45 : a.query === "NEET" ? .005 : 100);
      const phase = i % 30, factor = phase < 15 ? 1 - phase * .035 : .51 + (phase - 15) * .07;
      const isOutcome = a.kind === "outcome" || a.venue === "polymarket";
      const settlement = isOutcome && i >= count - 10;
      return { assetId: a.id, price: settlement ? 1 : isOutcome ? Math.min(.95, .3 + i * .004) : seed * factor * (1 + j * .01), observedAt: time, source: "synthetic scenario", synthetic: true, ...(settlement ? { settled: true, payout: 1 as const } : {}) };
    }) });
  }
  return frames;
}
