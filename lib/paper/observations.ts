import type { GNode } from "@/lib/api/graph";
import type { Workflow } from "@/lib/contracts/workflow";
import { freshPaperQuote, type PaperQuote, type PaperState } from "@/services/backend/src/workflows/paper";

export type MarketObservation = { assetId: string; quote: PaperQuote | null; message: string };

/** A quote is a new observation only once, even if the server returns it on several polls. */
export function quoteUpdates(incoming: MarketObservation[], previous: PaperState | null, now: number) {
  const result: Record<string, number> = {};
  for (const { assetId, quote } of incoming) {
    if (quote && quote.assetId === assetId && !quote.synthetic && freshPaperQuote(quote, now) &&
        (quote.price > 0 || quote.settled) && quote.observedAt > (previous?.quotes[assetId]?.observedAt ?? -Infinity))
      result[assetId] = quote.observedAt;
  }
  return result;
}

export function observedNodes(nodes: GNode[], w: Workflow, state: PaperState | null, items: MarketObservation[], updates: Record<string, number>, now: number): GNode[] {
  const byAsset = new Map(items.map(item => [item.assetId, item]));
  return nodes.map(node => {
    const signal = w.signals.find(s => node.id === "wf_sig_" + s.id);
    const order = w.stages.find(s => node.id === "wf_do_" + s.id);
    const gate = w.stages.find(s => node.id === "wf_when_" + s.id);
    const check = gate && state?.checks?.[gate.id];
    if (check) {
      const join = gate!.when && "args" in gate!.when ? gate!.when.op.toUpperCase() + " · " : "";
      const gap = check.unknown ? " · " + check.unknown + " awaiting data" : "";
      return { ...node, value: check.unknown === check.total ? "Awaiting data" : check.met + "/" + check.total + " met",
        detail: join + (check.result === true ? "Condition met" : check.result === false ? "Waiting for condition" : "Awaiting data") + gap + "\n" + node.detail };
    }
    if (gate && gate.when) return { ...node, value: "Awaiting check" };
    if (gate && gate.after.length && gate.after.every(dep => dep.event === "filled")) {
      const filled = gate.after.filter(dep => (state?.stages[dep.stageId]?.fills ?? 0) > 0).length;
      return { ...node, value: filled + "/" + gate.after.length + " filled" };
    }
    const id = signal?.assetId ?? order?.assetId;
    if (!id) return node;
    const item = byAsset.get(id), saved = state?.quotes[id];
    const quote = item ? item.quote && saved && saved.observedAt > item.quote.observedAt ? saved : item.quote : saved;
    const current = quote && quote.assetId === id && !quote.synthetic && (quote.price > 0 || quote.settled);
    const valid = current && freshPaperQuote(quote, now);
    const mark = valid ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumSignificantDigits: 6 }).format(quote.price)
      : current ? "Stale quote" : "Waiting for quote";
    const time = current ? " · " + new Date(quote.observedAt).toLocaleTimeString() : "";
    const quoteInfo = "Market quote: " + mark + time;
    const detail = quoteInfo + "\n" + node.detail;
    // On an order the flash belongs only to the market indicator. Fills have their own edge and trade log.
    return { ...node, ...(signal ? { value: mark } : {}), detail, quoteFlashAt: valid ? updates[id] : undefined };
  });
}
