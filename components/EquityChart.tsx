"use client";
import { useState } from "react";
export default function EquityChart({ points, synthetic }: { points: { ts: string; equityUsd: string | number }[]; synthetic?: boolean }) {
  const [range, setRange] = useState(0);
  const valid = points.map(p => ({ t: new Date(p.ts).getTime(), v: Number(p.equityUsd) })).filter(p => Number.isFinite(p.t) && Number.isFinite(p.v));
  const last = valid.at(-1)?.t ?? 0;
  const selected = range ? valid.filter(p => p.t >= last - range * 86400000) : valid;
  const data = selected.length ? selected : valid.slice(-1);
  if (!data.length) return <div className="q-equity-empty">Your equity chart appears after the first paper update.</div>;
  const values = data.map(p => p.v), min = Math.min(...values), max = Math.max(...values);
  const pad = Math.max((max - min) * .2, max * .004, 1), lo = min - pad, hi = max + pad;
  const start = data[0].t, end = data.at(-1)!.t;
  const x = (t: number) => 65 + (end === start ? .5 : (t - start) / (end - start)) * 915;
  const y = (v: number) => 174 - (v - lo) / (hi - lo) * 150;
  const path = data.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(2)},${y(p.v).toFixed(2)}`).join(" ");
  const date = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const axisDate = (t: number) => end-start < 172800000 ? new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }) : date(t);
  return <div className="q-equity">
    <div className="q-equity-toolbar"><span>Paper equity <span className="q-equity-source">{synthetic ? "· simulated prices" : "· account history"}</span></span><div role="group" aria-label="Chart time range" className="q-chart-ranges">{[[1,"1D"],[7,"7D"],[30,"30D"],[0,"All"]].map(([v,l]) => <button key={v} type="button" aria-pressed={range === v} onClick={() => setRange(Number(v))}>{l}</button>)}</div></div>
    <svg viewBox="0 0 1000 210" role="img" aria-label={`Paper equity, ${date(start)} to ${date(end)}: ${values[0].toFixed(2)} to ${values.at(-1)!.toFixed(2)} dollars.`} className="q-equity-svg">
      {[0,1,2,3].map(i => { const v = lo + (hi-lo)*i/3, yy = y(v); return <g key={i}><path d={`M65 ${yy}H980`} className="q-chart-grid" /><text x="0" y={yy+4}>{v.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})}</text></g>; })}
      {[0,1,2,3,4,5,6].map(i => { const xx = 65 + i/6*915; return <g key={i}><path d={`M${xx} 24V174`} className="q-chart-grid" />{(end !== start || i === 3) && <text x={xx} y="202" textAnchor={i===0?"start":i===6?"end":"middle"}>{axisDate(start+(end-start)*i/6)}</text>}</g>; })}
      {data.length>1 && <path d={`${path} L${x(end)},174 L${x(start)},174 Z`} fill="var(--accent)" opacity=".035" />}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={x(end)} cy={y(values.at(-1)!)} r="3" fill="var(--accent)" />
    </svg>
  </div>;
}
