import type { Strategy } from "../../contracts/src/strategy";
import type { Registry } from "../venues/registry";
import { humanize } from "./humanize";
import { workflowView } from "./workflow-view";

export interface StrategyNode { id: string; kind: "watch" | "when" | "do" | "exit"; title: string; detail: string; venue?: "robinhood" | "hyperliquid" | "solana" | "polymarket" }

/** Canvas nodes with titles (same shapes the compile stream emits as `partial.node`). Deterministic. */
export function strategyNodes(strategy: Strategy, reg: Registry, h = humanize(strategy, reg)): StrategyNode[] {
  if (strategy.workflow) return workflowView(strategy.workflow).nodes;
  const out: StrategyNode[] = [];
  const v = (id: string) => reg.get(id)?.venue as StrategyNode["venue"];
  const add = (n: StrategyNode) => { if (n.venue === undefined) delete n.venue; out.push(n); };
  const referenced = JSON.stringify(strategy.triggers);
  strategy.signals.forEach((s, i) => { if (referenced.includes(`\"${s.id}.`)) add({ id: s.id, kind: "watch", title: h.watch[i].split(" · ")[0], detail: h.watch[i], venue: "instrument" in s.params ? v(s.params.instrument) : undefined }); });
  strategy.triggers.forEach((t, i) => add({ id: t.id, kind: "when", title: "When", detail: h.when[i] }));
  strategy.actions.forEach((a, i) => {
    add({ id: a.id, kind: "do", title: h.do[i].split(" on ")[0], detail: h.do[i], venue: v(a.instrument) });
    if (a.exits && Object.keys(a.exits).length) add({ id: `${a.id}.exit`, kind: "exit", title: a.exits.takeProfits?.length ? "Take-profit ladder" : "Exit", detail: humanize({ ...strategy, actions: [a] }, reg).exit.filter((x) => !x.startsWith("Risk:")).join("\n") || "Exit rules" });
  });
  return out;
}
