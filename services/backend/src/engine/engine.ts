import type { Expr, Strategy } from "../../contracts/src/strategy";
import type { Snapshot, Val } from "./snapshot";

/** Engine state is plain JSON (persistable, replayable). */
export interface TriggerRt { state: "ready" | "holding" | "cooldown" | "done" | "blocked"; heldSince: number | null; cooldownUntil: number | null; fires: number; lastCond: boolean | null }
export interface EngineState { cycle: number; triggers: Record<string, TriggerRt>; prev: Record<string, Val> }
export type T3 = boolean | null;

export type EngineEvent =
  | { type: "trigger_met"; triggerId: string; forMinutes: number; holdUntil: number | null; path: string[] }
  | { type: "trigger_fired"; triggerId: string; fireIndex: number; actionIds: string[] };
export interface Intent { idempotencyKey: string; triggerId: string; fireIndex: number; actionId: string }
export interface StepResult { state: EngineState; events: EngineEvent[]; intents: Intent[]; conds: Record<string, T3> }

export function initState(s: Strategy): EngineState {
  return { cycle: 0, prev: {}, triggers: Object.fromEntries(s.triggers.map((t) => [t.id, { state: "ready", heldSince: null, cooldownUntil: null, fires: 0, lastCond: null }])) };
}

type Operand = { ref: string } | { lit: number | string | boolean };
function resolve(o: Operand, snap: Snapshot, prev: Record<string, Val>, usePrev: boolean): Val {
  if ("lit" in o) return o.lit;
  if (usePrev) return prev[o.ref] ?? null;
  const [sid, field] = o.ref.split(".");
  const s = snap[sid]; if (!s || s.stale) return null; // defense in depth: stale is always unknown
  return s.fields[field] ?? null;
}
const num = (v: Val) => (typeof v === "number" && Number.isFinite(v) ? v : null);
function cmp(op: string, a: Val, b: Val): T3 {
  if (a === null || b === null) return null; // unknown
  if (op === "eq") return a === b; if (op === "neq") return a !== b;
  const x = num(a), y = num(b); if (x === null || y === null) return null;
  switch (op) { case "lt": return x < y; case "lte": return x <= y; case "gt": return x > y; case "gte": return x >= y; }
  return null;
}
/** Kleene three-valued logic. Unknown never fires. Collects refs that contributed truth (for edge highlighting). */
export function evalExpr(e: Expr, snap: Snapshot, prev: Record<string, Val>, path: Set<string>): T3 {
  switch (e.op) {
    case "and": { let unk = false; const local = new Set<string>(); for (const a of e.args) { const v = evalExpr(a, snap, prev, local); if (v === false) return false; if (v === null) unk = true; } if (unk) return null; local.forEach((x) => path.add(x)); return true; }
    case "or": { let unk = false; for (const a of e.args) { const local = new Set<string>(); const v = evalExpr(a, snap, prev, local); if (v === true) { local.forEach((x) => path.add(x)); return true; } if (v === null) unk = true; } return unk ? null : false; }
    case "not": { const v = evalExpr(e.arg, snap, prev, new Set()); return v === null ? null : !v; }
    case "between": { const v = resolve(e.value, snap, prev, false), lo = resolve(e.low, snap, prev, false), hi = resolve(e.high, snap, prev, false); const a = cmp("gte", v, lo), b = cmp("lte", v, hi); const r = a === null || b === null ? null : a && b; if (r) addRefs([e.value, e.low, e.high], path); return r; }
    case "crosses_above": case "crosses_below": {
      const l = resolve(e.left, snap, prev, false), r = resolve(e.right, snap, prev, false);
      const pl = resolve(e.left, snap, prev, true), pr = resolve(e.right, snap, prev, true);
      const now = cmp(e.op === "crosses_above" ? "gt" : "lt", l, r), before = cmp(e.op === "crosses_above" ? "lte" : "gte", pl, pr);
      const res = now === null || before === null ? null : now && before; if (res) addRefs([e.left, e.right], path); return res;
    }
    default: { const r = cmp(e.op, resolve(e.left, snap, prev, false), resolve(e.right, snap, prev, false)); if (r) addRefs([e.left, e.right], path); return r; }
  }
}
function addRefs(ops: Operand[], path: Set<string>) { for (const o of ops) if ("ref" in o) path.add(o.ref.split(".")[0]); }
function collectRefs(e: Expr, out: Set<string>) {
  if (e.op === "and" || e.op === "or") e.args.forEach((a) => collectRefs(a, out));
  else if (e.op === "not") collectRefs(e.arg, out);
  else if (e.op === "between") { for (const o of [e.value, e.low, e.high] as Operand[]) if ("ref" in o) out.add(o.ref); }
  else { const c = e as Extract<Expr, { left: unknown }>; for (const o of [c.left, c.right] as Operand[]) if ("ref" in o) out.add(o.ref); }
}

/**
 * Pure step: (strategy, state, snapshot, now) -> (state', events, intents). No I/O, no clock reads.
 * Trigger lifecycle: ready -> (cond) holding -> (held forMinutes) fire -> cooldown|done.
 * `blocked` names are passed in by the caller (e.g. risk halt) and suppress firing without losing state.
 */
export function step(s: Strategy, st: EngineState, snap: Snapshot, now: number, opts: { blocked?: boolean } = {}): StepResult {
  const next: EngineState = { cycle: st.cycle + 1, prev: {}, triggers: {} };
  const events: EngineEvent[] = []; const intents: Intent[] = []; const conds: Record<string, T3> = {};
  for (const t of s.triggers) {
    const rt: TriggerRt = { ...(st.triggers[t.id] ?? { state: "ready", heldSince: null, cooldownUntil: null, fires: 0, lastCond: null }) };
    const path = new Set<string>();
    const cond = evalExpr(t.when, snap, st.prev, path);
    conds[t.id] = cond;
    if (rt.state === "cooldown" && rt.cooldownUntil !== null && now >= rt.cooldownUntil) { rt.state = "ready"; rt.cooldownUntil = null; }
    if (opts.blocked && rt.state !== "done") { if (rt.state !== "cooldown") { rt.state = "blocked"; rt.heldSince = null; } }
    else if (rt.state === "blocked") rt.state = "ready";

    if (rt.state === "ready" || rt.state === "holding") {
      if (cond !== true) { rt.state = "ready"; rt.heldSince = null; }
      else {
        if (rt.state === "ready") {
          rt.state = "holding"; rt.heldSince = now;
          events.push({ type: "trigger_met", triggerId: t.id, forMinutes: t.forMinutes, holdUntil: t.forMinutes > 0 ? now + t.forMinutes * 60_000 : null, path: [...path, t.id] });
        }
        if (now - (rt.heldSince ?? now) >= t.forMinutes * 60_000) {
          rt.fires += 1;
          const actionIds = s.actions.filter((a) => a.on.includes(t.id)).map((a) => a.id);
          events.push({ type: "trigger_fired", triggerId: t.id, fireIndex: rt.fires, actionIds });
          for (const aid of actionIds) intents.push({ idempotencyKey: `${t.id}:${rt.fires}:${aid}`, triggerId: t.id, fireIndex: rt.fires, actionId: aid });
          rt.heldSince = null;
          if (t.maxFires !== null && rt.fires >= t.maxFires) rt.state = "done";
          else if (t.cooldownMinutes > 0) { rt.state = "cooldown"; rt.cooldownUntil = now + t.cooldownMinutes * 60_000; }
          else rt.state = "ready";
        }
      }
    }
    rt.lastCond = cond;
    next.triggers[t.id] = rt;
  }
  // remember current values of every referenced field for crosses_* on the next cycle
  const refs = new Set<string>(); s.triggers.forEach((t) => collectRefs(t.when, refs));
  for (const r of refs) { const [sid, f] = r.split("."); next.prev[r] = snap[sid]?.fields[f] ?? null; }
  return { state: next, events, intents, conds };
}
