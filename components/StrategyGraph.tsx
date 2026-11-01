"use client";
// Quiver node graph (after Juno's templates/graph.js): Signal → Trigger → Action → Exit columns,
// orthogonal edges with 12px rounded elbows, port dots, dotted-grid canvas, amber light-arrows on hot edges.
// Data: contract-shaped nodes (compile `partial.node`) + edges derived from the Strategy (lib/api/graph).
// Motion is a placeholder (SMIL, power2.inOut) behind data-motion hooks; static end state when motion is off.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GEdge, GNode, NodeState } from "@/lib/api";
import { useFineMotion } from "@/src/motion/useMotionOK";
import EdgeComets from "@/src/motion/EdgeComets";
import { Popover } from "radix-ui";
import VenueMark from "./VenueMark";

const KIND_LABEL = { watch: "Signal", when: "Trigger", do: "Action", exit: "Exit" } as const;
const STATE_LABEL: Record<NodeState, string> = { idle: "", met: "Met", waiting: "Waiting", armed: "Armed", holding: "Holding", fired: "Fired", active: "Open", error: "Failed" } as Record<NodeState, string>;
import { graphLayout, type NodeBox as Box } from "@/lib/graph-layout";

/** Orthogonal route with rounded elbows (graph.js), horizontal or vertical. */
function route(a: Box, b: Box, vertical: boolean) {
  const r0 = 12;
  if (!vertical) {
    const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
    const r = Math.min(r0, Math.abs(y2 - y1) / 2), s = Math.sign(y2 - y1);
    const d = Math.abs(y2 - y1) < 1 ? `M${x1} ${y1}H${x2}` : `M${x1} ${y1}H${mx - r}Q${mx} ${y1} ${mx} ${y1 + s * r}V${y2 - s * r}Q${mx} ${y2} ${mx + r} ${y2}H${x2}`;
    return { d, p1: [x1, y1], p2: [x2, y2], deg: 0 };
  }
  const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y, my = (y1 + y2) / 2;
  const r = Math.min(r0, Math.abs(x2 - x1) / 2), s = Math.sign(x2 - x1);
  const d = Math.abs(x2 - x1) < 1 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}V${my - r}Q${x1} ${my} ${x1 + s * r} ${my}H${x2 - s * r}Q${x2} ${my} ${x2} ${my + r}V${y2}`;
  return { d, p1: [x1, y1], p2: [x2, y2], deg: 90 };
}

const CHIP: Partial<Record<NodeState, string>> = { met: "text-accent", holding: "text-accent", fired: "text-accent", active: "text-paper", error: "text-short", waiting: "text-muted" };

export default function StrategyGraph({ nodes, edges, revealed, ghosts, label, reserve }: { nodes: GNode[]; edges: GEdge[]; revealed?: number; ghosts?: number; label?: string; /** nodes whose layout height is reserved up front (no shift when the draft lands) */ reserve?: GNode[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0); // 0 = not measured yet (SSR / first paint): height comes from CSS container query, content hidden
  const motion = useFineMotion(); // Ellis: comets only on fine pointers without reduced motion
  const [hover, setHover] = useState<string | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current!; const set = () => setW(el.clientWidth); set();
    let frame = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(set); });
    ro.observe(el); return () => { cancelAnimationFrame(frame); ro.disconnect(); };
  }, []);
  const measured = W > 0;
  const vertical = false;
  const shownN = revealed ?? nodes.length;
  const list = nodes.slice(0, shownN);
  const { boxes, H, W: LW, skips } = useMemo(() => graphLayout(nodes, edges, W), [nodes, edges, W]);
  const reservedHeight = reserve ? graphLayout(reserve, [], W).H : 0;
  const minH = ghosts ? 240 : 0;
  const visible = (id: string) => list.some((n) => n.id === id);
  const linked = (e: GEdge) => !hover || e.from === hover || e.to === hover;

  return (
    <div ref={wrap} className="@container w-full" dir="ltr"><div className="-mx-1 max-h-[640px] overflow-auto overscroll-contain px-1 [scrollbar-width:thin] [touch-action:pan-x_pan-y]" tabIndex={0} role="region" aria-label="Strategy graph, scroll sideways to pan"><div className="relative"
      style={{ width: LW, height: Math.max(H, ghosts ? reservedHeight : 0, minH), visibility: measured ? undefined : "hidden" }} data-motion="graph" role="group"
      aria-label={label ?? `Strategy graph with ${nodes.length} nodes: signals feed triggers, triggers run actions, actions carry exits.`}>
      <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[12px] bg-[radial-gradient(var(--q-line2)_1px,transparent_1px)] [background-size:16px_16px] opacity-60" />
      <svg className="absolute inset-0 overflow-visible" width={LW} height={H} aria-hidden>
        {edges.map((e, i) => {
          const a = boxes[e.from], b = boxes[e.to];
          if (!a || !b || !visible(e.from) || !visible(e.to)) return null;
          const routed = route(a, b, vertical);
          const skip = skips.indexOf(e);
          const lane = 12 + skip * 8;
          const d = skip < 0 ? routed.d : `M${a.x + a.w} ${a.y + a.h / 2}H${a.x + a.w + 18}V${lane}H${b.x - 18}V${b.y + b.h / 2}H${b.x}`;
          const { p1, p2, deg } = routed;
          const id = `qe-${i}`, dim = !linked(e);
          return (
            <g key={id} data-motion="graph-edge" data-hot={e.hot ? "true" : undefined} style={{ opacity: dim ? 0.25 : 1, transition: "opacity .25s var(--ease)" }}>
              <path id={id} d={d} fill="none" stroke={e.hot ? "color-mix(in srgb, var(--q-amber) 45%, #2E2E34)" : "#2E2E34"} strokeWidth={1.25} />
              {/* motion on: Ellis's src/motion/EdgeComets draws light along this path (reads data-hot) */}
              {e.hot && !motion && <path d="M-7 -4.5 L1.5 0 L-7 4.5 L-5 0 Z" fill="var(--q-amber)" transform={`translate(${p2[0] - 5} ${p2[1]}) rotate(${deg})`} />}
              <circle cx={p1[0]} cy={p1[1]} r={3} fill="var(--q-bg)" stroke="#5A5650" strokeWidth={1.25} />
              <circle cx={p2[0]} cy={p2[1]} r={3} fill="var(--q-bg)" stroke={e.hot ? "var(--q-amber)" : "#5A5650"} strokeWidth={1.25} />
            </g>
          );
        })}
      </svg>
      {motion && measured && <EdgeComets />}
      {nodes.map((n) => {
        const b = boxes[n.id]; if (!b) return null;
        if (!visible(n.id)) return ghosts ? <div key={n.id} data-motion="ghost" className="absolute rounded-[12px] border border-dashed border-line-2 bg-white/[.015]" style={{ left: b.x, top: b.y, width: b.w, height: b.h }} /> : null;
        const lit = n.state === "met" || n.state === "holding" || n.state === "fired";
        return (
          <Popover.Root key={n.id}><Popover.Trigger asChild><button type="button" aria-label={`Details: ${n.title}`} data-motion="node-in" onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
            className={`absolute text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent rounded-[12px] border px-3.5 pb-3 pt-3 shadow-[var(--q-shadow-card)] transition-colors duration-200 ${lit ? "border-accent/55" : n.state === "error" ? "border-short/60" : "border-line hover:border-line-2"}`}
            style={{ left: b.x, top: b.y, width: b.w, height: b.h, animationDelay: `${b.depth * 100}ms`, background: "linear-gradient(180deg,#151517,#111113)" }}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-[7px] font-mono text-[12px] uppercase leading-none tracking-[.06em] text-muted">
                <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${n.kind === "when" ? "bg-cream" : n.state === "active" ? "bg-paper" : "bg-faint"} ${lit ? "shadow-[0_0_0_4px_color-mix(in_srgb,var(--q-amber)_18%,transparent)]" : ""}`} />
                <span>{KIND_LABEL[n.kind]}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {n.state && n.state !== "idle" && <span className={`font-mono text-[12px] leading-none ${CHIP[n.state]}`}>{STATE_LABEL[n.state]}</span>}
                {n.venue && <VenueMark venue={n.venue} size={18} />}
              </span>
            </div>
            <div className="mt-2 line-clamp-2 text-[14px] font-medium leading-tight tracking-[-0.005em] text-ink">{n.title}</div>
            {n.value !== undefined && <div className={`tnum mt-1.5 font-mono text-[19px] tracking-[-0.02em] ${n.value === "waiting" ? "text-[15px] text-muted" : "text-cream"}`} data-motion="tick" key={n.value}>{n.value}</div>}
            <div className={`mt-1 font-mono text-[12px] leading-snug text-muted ${n.kind === "when" ? "line-clamp-2" : "truncate"}`} title={n.detail}>{n.detail}</div>
          </button></Popover.Trigger>
          <Popover.Portal><Popover.Content side="bottom" align="center" sideOffset={8} collisionPadding={16} onOpenAutoFocus={(e) => e.preventDefault()} className="z-50 w-[min(340px,calc(100vw-32px))] max-h-[60vh] overflow-y-auto rounded-xl border border-line-2 bg-card p-4 text-ink shadow-2xl outline-none" aria-label={`${KIND_LABEL[n.kind]} details`}>
            <div className="flex items-center justify-between gap-3"><span className="font-mono text-[11px] uppercase tracking-widest text-muted">{KIND_LABEL[n.kind]}{n.venue ? ` · ${n.venue}` : ""}</span><Popover.Close aria-label="Close node details" className="-mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted hover:bg-white/5 focus-visible:outline-accent">×</Popover.Close></div>
            <p className="break-words text-[15px] font-medium leading-snug">{n.title}</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-2">{n.detail}</p>
            {n.value !== undefined && <p className="mt-3 font-mono text-[14px] text-accent">{n.value}</p>}
            {n.state && n.state !== "idle" && <p className="mt-2 text-[12px] text-muted">Status: {STATE_LABEL[n.state]}</p>}
          </Popover.Content></Popover.Portal></Popover.Root>
        );
      })}
    </div></div></div>
  );
}
