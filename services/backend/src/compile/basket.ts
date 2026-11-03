import type { PlanExpr, PlanStage, Workflow } from "../../contracts/src/workflow";
import { canonicalSymbol } from "./markets";

const symbolPattern = String.raw`\$?[a-z0-9][a-z0-9.-]{0,19}`;
const numberPattern = String.raw`\d+(?:\.\d+)?`;
const splitList = (value: string) => value.split(/\s*(?:,\s*(?:and\s+)?|\band\b|&)\s*/i);
const numeric = (value?: string) => value === undefined ? null : Number(value);
const movePattern = new RegExp(String.raw`^(?:the\s+)?(?:price\s+of\s+)?(${symbolPattern})(?:'s)?(?:\s+price)?\s+(?:(?:is|has)\s+)?(dro{1,2}p{1,2}s?|dip[sp]?|falls?|declines?|down|rises?|rose|gains?|climbs?|jumps?|up)\s*(?:by\s*)?(${numberPattern})\s*(?:%|percent)$`, "i");
const buyPattern = new RegExp(String.raw`^(?:buy\s+)?(?:\$\s*(${numberPattern})\s+(?:of\s+)?)?(${symbolPattern})(?:\s+(?:for|with)\s+\$\s*(${numberPattern}))?$`, "i");
const futurePattern = new RegExp(String.raw`^(?:open\s+|go\s+)?(?:an?\s+)?(?:(${numberPattern})\s*[x×]\s+)?(?:(long|short)\s+(?:on\s+)?(${symbolPattern})|(${symbolPattern})\s+(long|short))(?:\s+position)?(?:\s+(?:(?:at|with|using)\s+)?(${numberPattern})\s*[x×](?:\s+leverage)?)?(?:\s+(?:using|with)\s+\$\s*(${numberPattern})(?:\s+(?:of\s+)?margin)?)?$`, "i");

type Move = { symbol: string; percent: number };
type Order = { raw: string; symbol: string; side: PlanStage["side"]; amount: number | null; leverage: number };

function parseMove(raw: string): Move | null {
  const m = raw.trim().match(movePattern);
  if (!m) return null;
  const down = /^(?:dro|dip|fall|declin|down)/i.test(m[2]), size = Number(m[3]);
  if (!Number.isFinite(size) || size <= 0 || (down && size > 100)) return null;
  return { symbol: canonicalSymbol(m[1]), percent: down ? -size : size };
}
function parseOrder(raw: string, future: boolean): Order | null {
  const m = raw.trim().match(future ? futurePattern : buyPattern);
  if (!m || (!future && m[1] && m[3]) || (future && m[1] && m[6])) return null;
  const symbol = future ? m[3] ?? m[4] : m[2];
  const amount = numeric(future ? m[7] : m[1] ?? m[3]), leverage = future ? Number(m[1] ?? m[6] ?? 1) : 1;
  if (!/[a-z]/i.test(symbol) || leverage < 1 || leverage > 100 || (amount !== null && (amount <= 0 || amount > 1e12))) return null;
  return { raw: raw.trim(), symbol, side: future ? (m[2] ?? m[5]).toLowerCase() as "long" | "short" : "buy", amount, leverage };
}

/** A complete basket grammar, shared by guest and AI drafts. An unmatched clause belongs to the general planner. */
export function basketDraft(thesis: string): Workflow | null {
  const text = thesis.trim().replace(/[.!?]+$/, "");
  const parts = text.split(/\s*[,.;]?\s+(?:(?:and\s+)?then|(?:and\s+)?after\s+(?:that|the\s+(?:buys|fills)))\s*[:,]?\s+/i);
  if (parts.length > 2) return null;
  const primary = parts[0].replace(/[.,;]$/, "").trim();
  const actionFirst = primary.match(/^buy\s+(.+?)\s+(?:when|if|once)\s+(.+)$/i);
  const conditionFirst = primary.match(/^(?:if|when|once)\s+(.+?)[,;]?\s+buy\s+(.+)$/i);
  if (!actionFirst && !conditionFirst) return null;
  const buysText = (actionFirst ? actionFirst[1] : conditionFirst![2]).trim();
  let conditions = (actionFirst ? actionFirst[2] : conditionFirst![1]).replace(/[,;]$/, "").trim();
  let group: "all" | "each" | undefined = conditionFirst ? "all" : undefined;
  if (/\s+(?:all\s+together|together|at the same time|in the same observation)$/i.test(conditions)) {
    group = "all"; conditions = conditions.replace(/\s+(?:all\s+together|together|at the same time|in the same observation)$/i, "");
  } else if (/\s+(?:independently|respectively)$/i.test(conditions)) {
    group = "each"; conditions = conditions.replace(/\s+(?:independently|respectively)$/i, "");
  }
  const rawMoves = splitList(conditions).map(parseMove);
  const entries = splitList(buysText).map(x => parseOrder(x, false));
  const later = parts.length === 2 ? splitList(parts[1]).map(x => parseOrder(x, true)) : [];
  if (entries.length < 2 || entries.length > 8 || later.length > 8 || entries.length !== rawMoves.length ||
    entries.some(x => !x) || rawMoves.some(x => !x) || later.some(x => !x)) return null;
  const buys = entries as Order[], follow = later as Order[], moves = rawMoves as Move[];
  const percentages = new Map(moves.map(m => [m.symbol, m.percent]));
  if (new Set(buys.map(o => canonicalSymbol(o.symbol))).size !== buys.length || percentages.size !== buys.length ||
    buys.some(o => !percentages.has(canonicalSymbol(o.symbol)))) return null;
  // "$100 of A and B" does not specify how the amount is split.
  if (buys.some(o => o.amount !== null) && buys.some(o => o.amount === null)) return null;
  const assets: Workflow["assets"] = [], signals: Workflow["signals"] = [], stages: PlanStage[] = [];
  function instrument(o: Order) {
    const query = canonicalSymbol(o.symbol), perp = o.side === "long" || o.side === "short";
    const existing = assets.find(a => a.query === query && (a.kind === "perp") === perp);
    if (existing) return existing;
    const asset: Workflow["assets"][number] = { id: "asset_" + (assets.length + 1), query, sourceText: o.symbol, venue: perp ? "hyperliquid" : null, kind: perp ? "perp" : "token", outcome: null };
    assets.push(asset); return asset;
  }
  const gates: PlanExpr[] = buys.map((o, i) => {
    const a = instrument(o), delta = percentages.get(a.query)!, id = "move_" + (i + 1);
    signals.push({ id, assetId: a.id, kind: "price_change", change: { reference: "needs_choice", lookbackMinutes: null }, indicator: null, schedule: null,
      description: a.query + (delta < 0 ? " falls " : " rises ") + Math.abs(delta) + "%" });
    return { op: delta < 0 ? "lte" : "gte", left: { ref: id + ".value" }, right: { lit: delta } };
  });
  for (const [i, o] of [...buys, ...follow].entries()) {
    const first = i < buys.length, a = instrument(o);
    stages.push({ id: (first ? "buy_" : "position_") + (first ? i + 1 : i - buys.length + 1), assetId: a.id, side: o.side,
      sourceText: o.raw, conditionText: first ? (group === "all" ? signals.map(s => s.description).join(" AND ") : signals[i].description) : "After every entry order fills",
      when: first ? (group === "all" ? { op: "and", args: structuredClone(gates) } : gates[i]) : null,
      after: first ? [] : stages.slice(0, buys.length).map(s => ({ stageId: s.id, event: "filled" })),
      amount: { unit: "usd", value: o.amount }, leverage: o.leverage, funding: { kind: "budget", from: [] }, repeat: null,
      exits: { stopLossPct: null, takeProfitPct: null, trailingStopPct: null, timeExitHours: null, ladder: [], description: "" } });
  }
  const names = buys.map(o => canonicalSymbol(o.symbol)).join(", ");
  const positions = follow.map(o => o.side + " " + canonicalSymbol(o.symbol) + " " + o.leverage + "×").join(" and ");
  return { version: 1, name: ("Buy " + names + (positions ? ", then " + positions : "")).slice(0, 80),
    summary: signals.map(s => s.description).join(" · ") + ". Buy " + names + (positions ? ", then " + positions : "") + ".",
    budgetUsd: null, assets, signals, stages, questions: [], assumptions: [], ...(!group ? { entryGrouping: stages.slice(0, buys.length).map(s => s.id) } : {}) };
}

/** Verify recognizable market clauses individually when the rest of a request needs the AI planner. */
export function checkBoundClauses(w: Workflow, request: string): string[] {
  const segments = request.split("\n\nUser's answers")[0].split(/\s*(?:[,;]|\b(?:and|if|when|once|then|after that)\b)\s*/i).map(s => s.trim().replace(/[.!?]+$/, ""));
  const moves = segments.map(parseMove).filter((v): v is Move => !!v);
  const orders = segments.filter(s => /\d\s*[x×]/i.test(s)).map(s => parseOrder(s, true)).filter((v): v is Order => !!v);
  const leaves: { ref: string; op: string; threshold: number }[] = [];
  function walk(e: PlanExpr | null, negated = false) {
    if (!e) return;
    if ("args" in e) { e.args.forEach(child => walk(child, negated)); return; }
    if ("arg" in e) { walk(e.arg, !negated); return; }
    const reverse: Record<string,string> = { gt:"lt", gte:"lte", lt:"gt", lte:"gte", crosses_above:"crosses_below", crosses_below:"crosses_above" };
    const invert: Record<string,string> = { gt:"lte", gte:"lt", lt:"gte", lte:"gt" };
    const rightRef = "ref" in e.right;
    const ref = rightRef ? e.right : e.left, value = rightRef ? e.left : e.right;
    if (!("ref" in ref) || !("lit" in value) || typeof value.lit !== "number") return;
    const op = rightRef ? reverse[e.op] ?? e.op : e.op;
    leaves.push({ ref: ref.ref.split(".")[0], op: negated ? invert[op] ?? "" : op, threshold:value.lit });
  }
  w.stages.forEach(stage => walk(stage.when));
  const errors: string[] = [];
  for (const move of moves) {
    const signals = w.signals.filter(s => canonicalSymbol(w.assets.find(a => a.id === s.assetId)?.query ?? "") === move.symbol);
    // Only enforce a numeric comparison for the directly comparable signal representations.
    const comparable = signals.filter(s => s.kind === "drawdown" || s.kind === "price_change" || s.indicator?.name === "pct_change");
    if (!signals.length || (comparable.length && !comparable.some(s => leaves.some(leaf => {
      const expected = s.kind === "drawdown" ? -move.percent : move.percent;
      return leaf.ref === s.id && (s.kind !== "drawdown" || move.percent < 0) && leaf.threshold === expected &&
        (expected > 0 ? ["gt","gte","crosses_above"] : ["lt","lte","crosses_below"]).includes(leaf.op);
    })))) errors.push(`Preserve the ${move.percent}% price move on ${move.symbol} with its requested direction.`);
  }
  for (const o of orders) {
    if (!w.stages.some(s => s.side === o.side && s.leverage === o.leverage && canonicalSymbol(w.assets.find(a => a.id === s.assetId)?.query ?? "") === canonicalSymbol(o.symbol)))
      errors.push(`Preserve the ${o.symbol} ${o.side} at ${o.leverage}×; leverage belongs to that order.`);
  }
  return errors;
}
