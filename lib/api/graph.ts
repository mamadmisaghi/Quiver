// Graph model derived from a contract Strategy. Node ids are strategy-local ids (signals, triggers,
// actions, "<actionId>.exit"), per api-contracts.md §10. Titles come from compile `partial.node` frames.
import type { Expr, GraphNode, Strategy } from "./types";
import { workflowView } from "@/services/backend/src/engine/workflow-view";

export type NodeState = "idle" | "met" | "holding" | "fired" | "active" | "error" | "waiting";
export type GNode = GraphNode & { state?: NodeState; value?: string };
export type GEdge = { from: string; to: string; hot?: boolean };

function refs(e: Expr, out = new Set<string>()): Set<string> {
  if ("args" in e) e.args.forEach((a) => refs(a, out));
  else if ("arg" in e) refs(e.arg, out);
  else Object.values(e).forEach((o) => { if (o && typeof o === "object" && "ref" in o) out.add(String(o.ref).split(".")[0]); });
  return out;
}

export function strategyEdges(s: Strategy): GEdge[] {
  if (s.workflow) return workflowView(s.workflow).edges;
  const edges: GEdge[] = [];
  s.triggers.forEach((t) => refs(t.when).forEach((sig) => edges.push({ from: sig, to: t.id })));
  s.actions.forEach((a) => {
    a.on.forEach((t) => edges.push({ from: t, to: a.id }));
    if (a.exits && Object.keys(a.exits).length) edges.push({ from: a.id, to: `${a.id}.exit` });
  });
  return edges;
}
/** Fallback node list straight from the strategy when no titles are available. */
export function strategyNodes(s: Strategy, titles: Partial<Record<string, GraphNode>> = {}): GNode[] {
  if (s.workflow) return workflowView(s.workflow).nodes;
  const t = (id: string, n: GraphNode) => titles[id] ?? n;
  return [
    ...s.signals.filter((x) => s.triggers.some((v) => refs(v.when).has(x.id))).map((x) => t(x.id, { id: x.id, kind: "watch", title: x.id, detail: x.kind })),
    ...s.triggers.map((x) => t(x.id, { id: x.id, kind: "when", title: x.id, detail: `hold ${x.forMinutes} min` })),
    ...s.actions.map((x) => t(x.id, { id: x.id, kind: "do", title: `${x.side} ${x.instrument.split(":").at(-1)}`, detail: `${x.size.value} ${x.size.unit}` })),
    ...s.actions.filter((x) => x.exits && Object.keys(x.exits).length).map((x) => t(`${x.id}.exit`, { id: `${x.id}.exit`, kind: "exit", title: "Exit", detail: x.id })),
  ];
}
