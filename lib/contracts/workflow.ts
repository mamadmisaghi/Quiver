import { z } from "zod";
import { Venue } from "./common";

const Id = z.string().regex(/^[a-z][a-z0-9_]{0,31}$/);
const Op = z.enum(["lt", "lte", "gt", "gte", "eq", "neq", "crosses_above", "crosses_below"]);
const Operand = z.union([z.object({ ref: z.string().regex(/^[a-z][a-z0-9_]{0,31}\.[a-z_]{1,32}$/) }), z.object({ lit: z.union([z.number(), z.string().max(64), z.boolean()]) })]);
export type PlanExpr = { op: "and" | "or"; args: PlanExpr[] } | { op: "not"; arg: PlanExpr } | { op: z.infer<typeof Op>; left: z.infer<typeof Operand>; right: z.infer<typeof Operand> };
export const PlanExpr: z.ZodType<PlanExpr> = z.lazy(() => z.union([
  z.object({ op: z.enum(["and", "or"]), args: z.array(PlanExpr).min(2).max(8) }),
  z.object({ op: z.literal("not"), arg: PlanExpr }),
  z.object({ op: Op, left: Operand, right: Operand }),
]));
export const MarketCandidate = z.object({
  id: z.string().max(160), symbol: z.string().max(40), name: z.string().max(300), venue: Venue,
  kind: z.enum(["token", "perp", "spot", "outcome"]), source: z.enum(["preview_catalog", "dexscreener", "hyperliquid", "polymarket"]),
  address: z.string().max(100).nullable(), url: z.string().url().nullable(), maxLeverage: z.number().nullable(),
  endDate: z.string().max(64).nullable(), outcome: z.string().max(80).nullable(),
});
export type MarketCandidate = z.infer<typeof MarketCandidate>;
export const MarketResolution = z.object({ status: z.enum(["matched", "choose", "unavailable", "not_found"]), candidates: z.array(MarketCandidate).max(8), selectedId: z.string().max(160).nullable(), checkedAt: z.string(), message: z.string().max(500) });
export const PlanAsset = z.object({ id: Id, query: z.string().min(1).max(200), sourceText: z.string().min(1).max(300), venue: Venue.nullable(), kind: z.enum(["token", "perp", "spot", "outcome"]).nullable(), outcome: z.string().max(80).nullable(), resolution: MarketResolution.optional() });
export const PlanSignal = z.object({
  id: Id, assetId: Id.nullable(), kind: z.enum(["price", "drawdown", "indicator", "funding", "odds", "timer", "position", "custom"]),
  drawdown: z.object({ reference: z.enum(["needs_choice", "peak", "last_fill", "lookback"]), lookbackMinutes: z.number().positive().max(525600).nullable() }).optional(),
  indicator: z.object({ name: z.enum(["sma", "ema", "rsi", "atr", "bb_upper", "bb_lower", "pct_change"]), period: z.number().int().min(2).max(500), timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]) }).nullable(),
  schedule: z.object({ cron: z.string().max(64), tz: z.string().max(64) }).nullable(), description: z.string().max(400),
});
export const PlanStage = z.object({
  id: Id, assetId: Id, side: z.enum(["buy", "sell", "long", "short"]),
  sourceText: z.string().min(1).max(1000), conditionText: z.string().max(600), when: PlanExpr.nullable(),
  after: z.array(z.object({ stageId: Id, event: z.enum(["filled", "closed", "realized_profit", "resolved_profit"]) })).max(12),
  amount: z.object({ unit: z.enum(["usd", "pct_equity", "native", "pct_profits", "pct_position"]), value: z.number().positive().max(1e12).nullable() }),
  leverage: z.number().min(1).max(100), funding: z.object({ kind: z.enum(["budget", "profits"]), from: z.array(Id).max(12) }),
  repeat: z.object({ intervalMinutes: z.number().positive().max(525600).nullable(), maxTimes: z.number().int().positive().max(100000).nullable(), conditionMode: z.enum(["each_time", "once_then_repeat", "needs_choice"]) }).nullable(),
  exits: z.object({ stopLossPct: z.number().positive().max(100).nullable(), takeProfitPct: z.number().positive().nullable(), trailingStopPct: z.number().positive().max(100).nullable(), timeExitHours: z.number().positive().nullable(), ladder: z.array(z.object({ atPct: z.number().positive(), fraction: z.number().positive().max(1) })).max(8), description: z.string().max(500) }),
});
/** A reviewable plan is explicitly distinct from executable v1 rules. No made-up instrument ids. */
export const Workflow = z.object({
  version: z.literal(1), name: z.string().min(1).max(80), summary: z.string().max(1000),
  budgetUsd: z.number().positive().max(1e12).nullable(),
  assets: z.array(PlanAsset).min(1).max(16), signals: z.array(PlanSignal).max(24), stages: z.array(PlanStage).min(1).max(24),
  questions: z.array(z.string().max(300)).max(16),
  assumptions: z.array(z.string().max(300)).max(12).default([]),
  risk: z.object({ maxPositionPct: z.number().min(1).max(100).optional(), maxTotalExposurePct: z.number().min(1).max(100).optional(), maxDailyLossPct: z.number().min(1).max(100).optional(), maxOrdersPerDay: z.number().int().min(1).max(500).optional() }).optional(),
}).strict();
export type Workflow = z.infer<typeof Workflow>;
export type PlanStage = z.infer<typeof PlanStage>;
// Provider cannot assert resolved markets. Only our server adds lookup results.
export const WorkflowInput = Workflow.extend({ assets: z.array(PlanAsset.omit({ resolution: true })).min(1).max(16) });

export function expressionRefs(e: PlanExpr | null, out = new Set<string>()): Set<string> {
  if (!e) return out;
  if ("args" in e) e.args.forEach((v) => expressionRefs(v, out));
  else if ("arg" in e) expressionRefs(e.arg, out);
  else for (const o of [e.left, e.right]) if ("ref" in o) out.add(o.ref.split(".")[0]);
  return out;
}

/** Accept a provider's declared-id shorthand; canonical storage still requires id.field. */
export function prepareWorkflowInput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const copy = structuredClone(raw) as Record<string, any>;
  if (!Array.isArray(copy.assets) || !Array.isArray(copy.signals) || !Array.isArray(copy.stages)) return copy;
  const ids = new Set([...copy.assets, ...copy.signals].map((x) => x?.id));
  if (copy.assets.length === 1) for (const sig of copy.signals) if (sig && sig.assetId == null && ["price", "drawdown", "indicator", "funding", "odds", "position"].includes(sig.kind)) sig.assetId = copy.assets[0]?.id;
  let remaining = 1000;
  const walk = (e: any) => {
    if (!e || typeof e !== "object" || --remaining < 0) return;
    if (Array.isArray(e.args)) e.args.forEach(walk); else if (e.arg) walk(e.arg);
    else for (const operand of [e.left, e.right]) if (operand && typeof operand.ref === "string" && ids.has(operand.ref) && /^[a-z][a-z0-9_]{0,31}$/.test(operand.ref)) operand.ref += ".value";
  };
  copy.stages.forEach((s) => walk(s?.when)); return copy;
}
/** Normalize unambiguous provider field aliases before semantic validation. */
export function canonicalizeWorkflow(w: Workflow): Workflow {
  const copy = structuredClone(w);
  for (const signal of copy.signals) { if (signal.kind !== "drawdown") delete signal.drawdown; if (signal.kind !== "indicator") signal.indicator = null; if (signal.kind !== "timer") signal.schedule = null; }
  const walk = (e: PlanExpr | null) => {
    if (!e) return; if ("args" in e) { e.args.forEach(walk); return; } if ("arg" in e) { walk(e.arg); return; }
    for (const operand of [e.left, e.right]) if ("ref" in operand) {
      let [id, field] = operand.ref.split("."); let sig = copy.signals.find((s) => s.id === id);
      if (!sig && copy.assets.some((a) => a.id === id)) {
        const candidates = copy.signals.filter((s) => s.assetId === id && (field === "value" || field === s.kind || s.kind === "indicator" && field === s.indicator?.name || s.kind === "position" && ["qty", "pnl_pct", "value_usd"].includes(field)));
        if (candidates.length === 1) { sig = candidates[0]; id = sig.id; operand.ref = `${id}.${field}`; }
      }
      if (sig && sig.kind !== "position" && (field === sig.kind || sig.kind === "indicator" && field === sig.indicator?.name)) operand.ref = `${id}.value`;
    }
  };
  copy.stages.forEach((s) => { if (s.funding.kind === "budget") s.funding.from = []; walk(s.when); }); return copy;
}
export function workflowProblems(w: Workflow): string[] {
  const problems: string[] = [], assets = new Set(w.assets.map((a) => a.id)), sigs = new Set(w.signals.map((s) => s.id)), stages = new Set(w.stages.map((s) => s.id));
  for (const list of [w.assets, w.signals, w.stages]) if (new Set(list.map((x) => x.id)).size !== list.length) problems.push("Ids must be unique within each collection.");
  const used = new Set<string>();
  const checkFields = (e: PlanExpr | null) => {
    if (!e) return; if ("args" in e) { e.args.forEach(checkFields); return; } if ("arg" in e) { checkFields(e.arg); return; }
    for (const operand of [e.left, e.right]) if ("ref" in operand) { const [id, field] = operand.ref.split("."), sig = w.signals.find((s) => s.id === id); if (sig && !(sig.kind === "position" ? ["value", "qty", "pnl_pct", "value_usd"] : ["value"]).includes(field)) problems.push(`Unknown field ${operand.ref}; use the documented signal value.`); }
  };
  w.stages.forEach((s) => checkFields(s.when));
  for (const s of w.signals) if (s.assetId && !assets.has(s.assetId)) problems.push(`Unknown asset on ${s.id}.`);
  for (const s of w.signals) {
    if (s.kind === "drawdown" && !s.drawdown) problems.push(`Choose a drawdown reference on ${s.id}.`);
    if (s.drawdown?.reference === "lookback" && !s.drawdown.lookbackMinutes) problems.push(`Set a lookback period on ${s.id}.`);
  }
  for (const s of w.stages) {
    if (!assets.has(s.assetId)) problems.push(`Unknown asset on ${s.id}.`);
    expressionRefs(s.when).forEach((id) => { used.add(id); if (!sigs.has(id)) problems.push(`Unknown signal ${id}.`); });
    for (const d of s.after) if (!stages.has(d.stageId) || d.stageId === s.id) problems.push(`Invalid dependency on ${s.id}.`);
    for (const id of s.funding.from) if (!s.after.some((d) => d.stageId === id && (d.event === "realized_profit" || d.event === "resolved_profit"))) problems.push(`Profit funding on ${s.id} needs a realized-profit dependency on ${id}.`);
    if (s.funding.kind === "profits" && !s.funding.from.length) problems.push(`Name the profit source for ${s.id}.`);
    if (s.exits.ladder.reduce((n, x) => n + x.fraction, 0) > 1.000001) problems.push(`Exit fractions on ${s.id} exceed the original position.`);
    if (s.amount.unit.startsWith("pct_") && (s.amount.value ?? 0) > 100) problems.push(`Allocation on ${s.id} exceeds 100%.`);
  }
  const visit = (id: string, path: Set<string>): boolean => {
    if (path.has(id)) return false;
    const next = new Set(path).add(id); return (w.stages.find((s) => s.id === id)?.after ?? []).every((d) => visit(d.stageId, next));
  };
  if (w.stages.some((s) => !visit(s.id, new Set()))) problems.push("Stage dependencies form a cycle. Repeats belong on the stage, not on dependency edges.");
  if (w.signals.some((s) => !used.has(s.id))) problems.push("Every signal must be used by a stage condition.");
  return [...new Set(problems)];
}

export function workflowBlockers(w: Workflow): string[] {
  const out = [...w.questions];
  w.assets.forEach((a) => { if (!a.resolution?.selectedId) out.push(a.resolution?.message ?? `Choose the exact market for ${a.query}.`); });
  w.signals.forEach((s) => { if (s.drawdown?.reference === "needs_choice") out.push(`Choose the price reference for the drop on ${s.id}.`); });
  w.stages.forEach((s) => {
    const a = w.assets.find((a) => a.id === s.assetId), selected = a?.resolution?.candidates.find((c) => c.id === a.resolution?.selectedId);
    if (selected?.maxLeverage && s.leverage > selected.maxLeverage) out.push(`${s.id}: requested ${s.leverage}× exceeds this market's ${selected.maxLeverage}× maximum. Refine the leverage or market.`);
    if (selected && selected.kind !== "perp" && (s.side === "long" || s.side === "short" || s.leverage > 1)) out.push(`${s.id}: choose a perpetual market for leveraged long/short orders.`);
    if (s.amount.value === null) out.push(`Set the amount for ${s.id}.`);
    if (s.repeat && !w.budgetUsd && s.funding.kind === "budget") out.push("Set a dedicated strategy budget before repeated purchases.");
    if (s.repeat?.conditionMode === "needs_choice") out.push(`Choose whether ${s.id} checks the condition every time or only to start.`);
  });
  return [...new Set(out)];
}
