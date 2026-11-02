"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Activity, ChartNoAxesCombined, Filter, ShoppingCart, Shield, TrendingUp, X } from "lucide-react";
import { Popover } from "radix-ui";
import NodeDetails from "../NodeDetails";

/** Illustrative graph; real strategies continue to use StrategyGraph. */
export default function PreviewWorkflow({ probability = false, crossVenue = false }: { probability?: boolean; crossVenue?: boolean }) {
  const uid = useId().replace(/:/g, "");
  const graph = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const el = graph.current;
    if (!el || !window.IntersectionObserver) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const sync = () => setPlaying(visible && !document.hidden && !preference.matches);
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
    observer.observe(el);
    document.addEventListener("visibilitychange", sync); preference.addEventListener("change", sync);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", sync); preference.removeEventListener("change", sync); };
  }, []);
  const width = crossVenue ? 960 : 765;
  const nodes = [
    { id: "price", x: 10, y: 30, title: probability ? "Fed-cut odds" : "NVDA price", detail: probability ? "Polymarket · above 70%" : "Market price signal", kind: "Signal", Icon: ChartNoAxesCombined, full: probability ? "Watch the selected Polymarket outcome. Its probability must be above 70%." : "Read the latest NVDA price. It must be below its 20-day moving average." },
    { id: "average", x: 10, y: 160, title: probability ? "NVDA below SMA20" : "20-day average", detail: probability ? "Price vs 20-day average" : "NVDA · daily candles", kind: "Signal", Icon: Activity, full: "Compare NVDA's price with its 20-day simple moving average using daily candles." },
    { id: "when", x: 205, y: 95, title: "Conditions met", detail: "All rules true", kind: "Trigger", Icon: Filter, full: "Continue only when all connected conditions are true and the price data is fresh." },
    { id: "buy", x: 400, y: 95, title: "Buy $200 NVDA", detail: "Paper market order", kind: "Action", Icon: ShoppingCart, full: "Simulate a $200 NVDA market order. This example never places a real-money trade." },
    ...(crossVenue ? [{ id: "sol", x: 595, y: 95, title: "Open 2× SOL", detail: "$250 · Hyperliquid", kind: "Action", Icon: TrendingUp, full: "After the NVDA order, simulate a $250 SOL long at 2× leverage on Hyperliquid. Both positions have an 8% stop-loss." }] : []),
    { id: "stop", x: crossVenue ? 790 : 595, y: 95, title: "Stop at −8%", detail: "Position risk limit", kind: "Exit", Icon: Shield, full: "Close each simulated position if its price falls 8% below its filled entry price." },
  ];
  const paths = ["M170 68H181Q190 68 190 77V124Q190 133 199 133H205", "M170 198H181Q190 198 190 189V142Q190 133 199 133H205", "M365 133H400", "M560 133H595"];
  if (crossVenue) paths.push("M755 133H790");
  return <div ref={graph} data-playing={playing} className={`q-preview-graph${crossVenue ? " q-preview-cross" : ""}`} style={{ aspectRatio: `${width} / 270` }} role="group" aria-label={`Example workflow: two signals feed one trigger, then ${crossVenue ? "NVDA and SOL orders" : "a buy"} and stop-loss exit`}>
    <svg className="q-preview-wires" viewBox={`0 0 ${width} 270`} preserveAspectRatio="none" aria-hidden="true">
      <defs><marker id={`${uid}-arrow`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill="none" stroke="var(--accent)" /></marker></defs>
      {paths.map((d, i) => <g key={d}>
        <path d={d} vectorEffect="non-scaling-stroke" fill="none" stroke="var(--accent)" strokeOpacity=".65" strokeWidth="1.3" markerEnd={`url(#${uid}-arrow)`} />
        <circle r="2.3" fill="var(--accent)" className="q-demo-pulse" data-leg={i < 2 ? "inputs" : i === 2 ? "order" : i === 3 ? "next" : "risk"} style={{ offsetPath: `path("${d}")` }} />
      </g>)}
    </svg>
    {nodes.map(({ id, x, y, title, detail, kind, Icon, full }) => <NodeDetails key={id} className="q-node-popover" sideOffset={10} label={`${title} example details`} trigger={<button type="button" className={`q-preview-node q-preview-node-${id}`} style={{ left: `${x / width * 100}%`, top: `${y / 270 * 100}%`, width: `${160 / width * 100}%` }} aria-label={`Example ${kind.toLowerCase()}: ${title}`}><Icon size={21} strokeWidth={1.5} /><span><strong>{title}</strong><small>{detail}</small></span></button>}>
      <div className="flex items-center justify-between gap-4"><span className="text-[12px] text-muted">{kind} · Example</span><Popover.Close aria-label="Close details" className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/5"><X size={14} /></Popover.Close></div><strong className="block text-[15px] font-medium">{title}</strong><p className="mt-2 text-[13px] leading-relaxed text-muted">{full}</p>
    </NodeDetails>)}
  </div>;
}
