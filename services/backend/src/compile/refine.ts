import type { Strategy } from "../../contracts/src/strategy";

/** Exact, narrow edits do not need a model or a fresh asset decision. */
export function localRefine(base: Strategy, text: string): Strategy | null {
  const t = text.trim(); const n = structuredClone(base);
  const max = t.match(/^(?:change|set) (?:the )?max(?:imum)? position(?: cap)? (?:to )?(\d+(?:\.\d+)?)\s*%[.!]?$/i);
  if (max && Number(max[1]) >= 1 && Number(max[1]) <= 100) { n.risk.maxPositionPct = Number(max[1]); return n; }
  const ladder = t.match(/^add a take[- ]profit ladder:\s*sell a third at \+(\d+(?:\.\d+)?)%,?\s*a third at \+(\d+(?:\.\d+)?)%,?\s*(?:and )?a third at \+(\d+(?:\.\d+)?)%[.!]?$/i);
  if (ladder) {
    const levels = ladder.slice(1).map(Number); if (levels.some((v, i) => v <= 0 || i > 0 && v <= levels[i - 1])) return null;
    if (n.workflow) {
      if (n.workflow.stages.length !== 1) return null;
      const x = n.workflow.stages[0].exits; x.ladder = levels.map((atPct) => ({ atPct, fraction: 1 / 3 })); x.takeProfitPct = null;
    } else {
      const entries = n.actions.filter((a) => a.type === "open"); if (entries.length !== 1) return null;
      entries[0].exits ??= {}; delete entries[0].exits.takeProfit;
      entries[0].exits.takeProfits = levels.map((v) => ({ atPct: String(v), sellFraction: String(1 / 3) }));
    }
    return n;
  }
  return null;
}
