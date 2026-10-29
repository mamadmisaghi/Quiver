import type { Strategy } from "../../contracts/src/strategy";
import type { Registry } from "../venues/registry";
import { humanize } from "./humanize";

export interface StrategyNode { id: string; kind: "watch" | "when" | "do" | "exit"; title: string; detail: string; venue?: "robinhood" | "hyperliquid" | "solana" | "polymarket" }

/** Canvas nodes with titles (same shapes the compile stream emits as `partial.node`). Deterministic. */
export function strategyNodes(strategy: Strategy, reg: Registry, h = humanize(strategy, reg)): StrategyNode[] {
  const out: StrategyNode[] = [];
  const v = (id: string) => reg.get(id)?.venue as StrategyNode["venue"];
  const add = (n: StrategyNode) => { if (n.venue === undefined) delete n.venue; out.push(n); };
  strategy.signals.forEach((s, i) => add({ id: s.id, kind: "watch", title: h.watch[i].split(" · ")[0], detail: h.watch[i], venue: "instrument" in s.params ? v(s.params.instrument) : undefined }));
  strategy.triggers.forEach((t, i) => add({ id: t.id, kind: "when", title: "When", detail: h.when[i] }));
  strategy.actions.forEach((a, i) => {
    add({ id: a.id, kind: "do", title: h.do[i].split(" on ")[0], detail: h.do[i], venue: v(a.instrument) });
    if (a.exits) add({ id: `${a.id}.exit`, kind: "exit", title: "Exit", detail: h.exit.find((x) => x.startsWith(reg.get(a.instrument)?.symbol ?? "\u0000")) ?? "Exit rules" });
  });
  return out;
}
