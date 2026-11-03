import { z } from "zod";
import type { Workflow, PlanStage } from "@/lib/contracts/workflow";
import { freshPaperQuote, paperDependencyMet, type PaperQuote, type PaperState, type PaperStepEvent } from "@/services/backend/src/workflows/paper";

export type MarketObservation = { assetId: string; quote: PaperQuote | null; message: string };
export const ActivityRow = z.object({
  seq: z.number().int().nonnegative(), at: z.number().finite(),
  kind: z.enum(["session", "quote", "check", "condition", "trigger", "fill", "wait", "issue", "edit"]),
  label: z.string(), detail: z.string(),
});
export type ActivityRow = z.infer<typeof ActivityRow>;
export type ActivityNote = Omit<ActivityRow, "seq">;

export const marketPrice = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumSignificantDigits: 7 }).format(value);
export function assetSymbol(w: Workflow, id: string) {
  const a = w.assets.find(asset => asset.id === id);
  return a?.resolution?.candidates.find(c => c.id === a.resolution?.selectedId)?.symbol ?? a?.query ?? id;
}
export function stageLabel(w: Workflow, id: string) {
  const stage = w.stages.find(s => s.id === id);
  return stage ? ({ buy: "Buy", sell: "Sell", long: "Long", short: "Short" }[stage.side] + " " + assetSymbol(w, stage.assetId)) : id;
}

/** A newer vendor timestamp is counted only when the engine can use that observation. */
export function quoteUpdates(incoming: MarketObservation[], previous: PaperState | null, now: number) {
  const result: Record<string, number> = {};
  for (const { assetId, quote } of incoming) {
    if (quote && quote.assetId === assetId && !quote.synthetic && freshPaperQuote(quote, now) &&
        (quote.price > 0 || quote.settled) && quote.observedAt > (previous?.quotes[assetId]?.observedAt ?? -Infinity))
      result[assetId] = quote.observedAt;
  }
  return result;
}

export function fillNote(w: Workflow, fill: PaperState["events"][number]): ActivityNote {
  return { at: fill.at, kind: "fill", label: fill.kind === "settle" ? "Settled" : fill.kind === "exit" ? "Exit filled" : "Paper fill",
    detail: stageLabel(w, fill.stageId) + " · " + marketPrice(fill.amount) + " at " + marketPrice(fill.price) + " · " + fill.detail };
}

export function tickActivity(w: Workflow, before: PaperState, after: PaperState, items: MarketObservation[], trace: PaperStepEvent[]): ActivityNote[] {
  if (after.lastAt <= before.lastAt) return [];
  const at = after.lastAt, notes: ActivityNote[] = [];
  const add = (kind: ActivityNote["kind"], label: string, detail: string) => notes.push({ at, kind, label, detail });
  const fresh = Object.keys(quoteUpdates(items, before, at));
  if (fresh.length) add("quote", "Quotes received", fresh.map(id => assetSymbol(w, id) + " " + marketPrice(after.quotes[id].price)).join(" · "));
  const checks = Object.values(after.checks ?? {});
  const readable = Object.values(after.readings ?? {}).filter(v => v !== null).length;
  const unavailable = items.filter(i => !i.quote || !freshPaperQuote(i.quote, at)).map(i => assetSymbol(w, i.assetId));
  const summary = checks.length ? checks.filter(c => c.result === true).length + " of " + checks.length + " entry conditions true" : "Checked scheduled orders and dependencies";
  add("check", checks.length ? "Conditions checked" : "Markets checked", summary + (unavailable.length ? " · Awaiting fresh " + unavailable.join(", ") : fresh.length || readable ? "" : " · No new quote"));

  // Interleave upstream fills and their dependent triggers in the exact execution order.
  const fills = after.events.filter(e => e.at === at);
  for (const event of trace) {
    const name = stageLabel(w, event.stageId);
    if (event.kind === "condition") { add("condition", "Conditions met", name); continue; }
    if (event.kind === "fill") add("trigger", "Trigger fired", name);
    const index = fills.findIndex(f => f.stageId === event.stageId && (event.kind === "exit" ? f.kind === "exit" || f.kind === "settle" : f.kind === "buy" || f.kind === "sell"));
    if (index >= 0) notes.push(fillNote(w, fills.splice(index, 1)[0]));
  }
  for (const fill of fills) notes.push(fillNote(w, fill));
  for (const stage of w.stages) {
    const status = after.stages[stage.id].status;
    if (before.stages[stage.id]?.status === status || !/blocked|risk limit|cannot cover|outside allowed|waiting for (fresh|enough|predecessor)/i.test(status)) continue;
    const issue = /blocked|risk limit|cannot cover/i.test(status);
    add(issue ? "issue" : "wait", issue ? "Order held" : "Waiting", stageLabel(w, stage.id) + " · " + status);
  }
  return notes;
}

export function dependencyDetail(w: Workflow, stage: PlanStage, state: PaperState | null) {
  const status = state?.stages[stage.id];
  const previous = status?.status === "Waiting for the next set of predecessor fills"
    ? new Map(status.consumedDependency?.split("|").map(part => { const [id, , fills] = part.split(":"); return [id, Number(fills)] as const; })) : null;
  return stage.after.map(dep => {
    const name = stageLabel(w, dep.stageId);
    const wording = { filled: "fill", closed: "close", realized_profit: "realized profit", resolved_profit: "settled profit" }[dep.event];
    const met = !!state && paperDependencyMet(state, dep) && (!previous || dep.event !== "filled" || state.stages[dep.stageId].fills > (previous.get(dep.stageId) ?? 0));
    return { met, text: name + " · " + wording };
  });
}
