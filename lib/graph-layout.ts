import type { GEdge, GNode } from "./api/graph";
export type NodeBox = { x: number; y: number; w: number; h: number; depth: number };
// The previous horizontal layout used a 56px connector gap. Keep 10% more room.
export const GRAPH_GAP = 56 * 1.1;
export const NODE_WIDTH = 200;
export function graphLayout(nodes: GNode[], edges: GEdge[], available = 0) {
  const depths = new Map<string, number>(), ids = new Set(nodes.map((n) => n.id));
  const rank = (id: string, path = new Set<string>()): number => {
    if (depths.has(id)) return depths.get(id)!;
    if (path.has(id)) return 0;
    const parents = edges.filter((e) => e.to === id && ids.has(e.from));
    const d = parents.length ? Math.max(...parents.map((e) => rank(e.from, new Set(path).add(id)) + 1)) : edges.length ? 0 : Math.max(0, ["watch", "when", "do", "exit"].indexOf(nodes.find((n) => n.id === id)!.kind));
    depths.set(id, d); return d;
  };
  nodes.forEach((n) => rank(n.id));
  const columns = Array.from({ length: Math.max(0, ...depths.values()) + 1 }, (_, d) => nodes.filter((n) => depths.get(n.id) === d));
  const height = (n: GNode) => (n.value === undefined ? 104 : 132) + (n.kind === "when" ? 14 : 0);
  const columnHeights = columns.map((ns) => ns.reduce((h, n) => h + height(n), 0) + Math.max(0, ns.length - 1) * 20);
  const skips = edges.filter((e) => (depths.get(e.to) ?? 0) - (depths.get(e.from) ?? 0) > 1);
  const top = skips.length ? 28 + skips.length * 8 : 8;
  const H = Math.max(0, ...columnHeights) + top + 8;
  const contentWidth = columns.length * NODE_WIDTH + Math.max(0, columns.length - 1) * GRAPH_GAP;
  const W = Math.max(available, contentWidth), boxes: Record<string, NodeBox> = {};
  columns.forEach((ns, depth) => {
    let y = top + (H - top - 8 - columnHeights[depth]) / 2;
    ns.forEach((n) => { boxes[n.id] = { x: depth * (NODE_WIDTH + GRAPH_GAP), y, w: NODE_WIDTH, h: height(n), depth }; y += height(n) + 20; });
  });
  return { boxes, H, W, skips };
}
