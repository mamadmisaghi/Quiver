"use client";
// M4.3: GET /v1/portfolio/runs, /portfolio/allocation?by=, /portfolio/history. Paper mode only in the UI for now.
import { useState } from "react";
import Link from "@/components/Link";
import PageHeader from "@/components/PageHeader";
import Wrap from "@/components/Wrap";
import Loading from "@/components/Loading";
import { Card } from "@/components/ui";
import { api, fmtNum, fmtUsd, fmtPct, tone, RUN_STATUS, fmtInstrument, type AllocationBy, type PortfolioHistory } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";

const BY: [AllocationBy, string][] = [["venue", "Venue"], ["asset_class", "Asset class"], ["instrument", "Instrument"]];
const VENUE: Record<string, string> = { hyperliquid: "Hyperliquid", robinhood: "Robinhood Chain", polymarket: "Polymarket" };
const label = (by: AllocationBy, key: string, l: string) => by === "venue" ? VENUE[key] ?? l : by === "instrument" ? fmtInstrument(key) : l.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const day = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const tab = (on: boolean) => `btn rounded-full border px-3.5 py-1.5 text-[13px] ${on ? "border-accent/60 text-accent" : "border-line-2 text-ink-2 hover:bg-white/5"}`;

function History({ h }: { h: PortfolioHistory }) {
  const pts = h.points;
  if (pts.length < 2) return <p className="mt-4 text-[13.5px] text-muted" data-testid="pf-history-empty">The chart starts after your first paper run records equity.</p>;
  const W = 600, H = 160, ys = pts.map((p) => Number(p.equityUsd)), mn = Math.min(...ys), mx = Math.max(...ys);
  const x = (i: number) => (i / (pts.length - 1)) * W, y = (v: number) => H - 6 - ((v - mn) / (mx - mn || 1)) * (H - 12);
  const d = ys.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1], up = !last.pnlUsd.startsWith("-"), col = up ? "var(--q-up)" : "var(--q-down)";
  return (
    <figure className="mt-4" data-testid="pf-history">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[160px] w-full" role="img" aria-label={`Combined paper equity from ${fmtUsd(pts[0].equityUsd)} to ${fmtUsd(last.equityUsd)}`}>
        <path d={`${d} L${W},${H} L0,${H} Z`} fill={col} fillOpacity=".06" />
        <path d={d} fill="none" stroke={col} strokeWidth="1.5" vectorEffect="non-scaling-stroke" data-motion="portfolio-line" />
      </svg>
      <figcaption className="mt-2 flex justify-between font-mono text-[11.5px] tabular-nums text-muted"><span>{day(pts[0].ts)}</span><span>low {fmtUsd(String(mn), { dp: 0 })} · high {fmtUsd(String(mx), { dp: 0 })}</span><span>{day(last.ts)}</span></figcaption>
    </figure>);
}

export default function PortfolioView() {
  const [by, setBy] = useState<AllocationBy>("venue");
  const runs = useQ(() => api.portfolioRuns({ mode: "paper", status: "all" }), []);
  const hist = useQ(() => api.portfolioHistory({ mode: "paper", points: 200 }), []);
  const pos = useQ(() => api.positions({ mode: "paper" }), []); // M4.6 server-marked
  const alloc = useQ(() => api.portfolioAllocation({ mode: "paper", by }), [by]);
  const t = runs.data?.totals;
  return (
    <Wrap>
      <PageHeader title="Portfolio" sub="All your paper runs together, stopped runs included. Paper results don't predict live results." />
      {!runs.data ? <Loading h={200} q={runs} /> : (<>
        <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="pf-totals">
          {([["Equity", fmtUsd(t!.equityUsd), ""], ["P&L", `${fmtUsd(t!.pnlUsd, { sign: true })}`, tone(t!.pnlUsd)], ["Return", fmtPct(t!.pnlPct, { sign: true }), tone(t!.pnlPct)], ["Realized", fmtUsd(t!.realizedPnlUsd, { sign: true }), tone(t!.realizedPnlUsd)], ["Unrealized", fmtUsd(t!.unrealizedPnlUsd, { sign: true }), tone(t!.unrealizedPnlUsd)], ["Fees", fmtUsd(t!.feesUsd), "text-ink-2"]] as const).map(([k, v, c]) => (
            <Card key={k} className="p-4"><div className="text-[12px] text-muted">{k}</div><div className={`mt-1 font-mono text-[17px] tabular-nums ${c}`}>{v}</div></Card>))}
        </div>
        <Card className="mt-3 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-medium">Combined equity</h2><span className="text-[12px] text-muted">{t!.openPositions} open position{t!.openPositions === 1 ? "" : "s"} · {t!.fills} fills</span></div>
          {!hist.data ? <Loading h={160} q={hist} /> : <History h={hist.data} />}
        </Card>
        <Card className="mt-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-medium">Allocation <span className="text-[12px] font-normal text-muted">open positions</span></h2>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Group by">{BY.map(([v, l]) => <button key={v} role="tab" aria-selected={by === v} onClick={() => setBy(v)} className={tab(by === v)}>{l}</button>)}</div>
          </div>
          {!alloc.data ? <Loading h={120} q={alloc} /> : alloc.data.items.length === 0 ? <p className="mt-4 text-[13.5px] text-muted">No open positions right now.</p> : (
            <ul className="mt-4 grid gap-3" data-testid="pf-alloc">
              {alloc.data.items.map((a) => (
                <li key={a.key} className="text-[13.5px]">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="text-ink">{label(by, a.key, a.label)} <span className="text-[12px] text-muted">· {a.positions} pos</span></span><span className="font-mono tabular-nums text-ink-2">{fmtUsd(a.grossUsd)} · {fmtPct(a.weightPct, { dp: 1 })}</span></div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/5" aria-hidden><div className="h-full rounded-full bg-accent/80" style={{ width: `${Math.min(100, Number(a.weightPct))}%` }} /></div>
                  {a.shortUsd !== "0" && <div className="mt-1 font-mono text-[11.5px] tabular-nums text-muted">long {fmtUsd(a.longUsd)} · short {fmtUsd(a.shortUsd)} · net {fmtUsd(a.netUsd)}</div>}
                </li>))}
              <li className="flex flex-wrap justify-between gap-2 border-t border-line pt-3 font-mono text-[12px] tabular-nums text-muted"><span>gross {fmtUsd(alloc.data.grossExposureUsd)} · net {fmtUsd(alloc.data.netExposureUsd)}</span><span>cash {fmtUsd(alloc.data.cashUsd)}</span></li>
            </ul>)}
        </Card>
        <Card className="mt-3 overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5"><h2 className="font-medium">Open positions</h2>{pos.data && <span className="text-[12px] text-muted" data-testid="pf-asof">Marked {new Date(pos.data.asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}</div>
          {!pos.data ? <div className="p-5"><Loading h={80} q={pos} /></div> : pos.data.items.length === 0 ? <p className="p-5 text-[13.5px] text-muted" data-testid="pf-pos-empty">No open paper positions. Active runs show theirs here once an order fills.</p> : (
            <div className="relative mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]" data-testid="pf-positions">
                <thead><tr className="text-left text-[12px] text-muted"><th className="px-5 py-2 font-normal">Market</th><th className="font-normal">Strategy</th><th className="text-right font-normal">Qty</th><th className="text-right font-normal">Entry</th><th className="text-right font-normal">Mark</th><th className="px-5 text-right font-normal">Unrealized</th></tr></thead>
                <tbody>{pos.data.items.map((p) => (
                  <tr key={`${p.runId}:${p.instrument}`} className="border-t border-line">
                    <td className="px-5 py-3"><div className="text-ink">{p.symbol} <span className={p.side === "long" ? "text-ink-2" : "text-warn"}>{p.side === "long" ? "Long" : "Short"}</span></div><div className="text-[11.5px] text-muted">{fmtInstrument(p.instrument)}</div></td>
                    <td className="max-w-[180px] truncate"><Link className="underline" href={`/app/run/${p.runId}`}>{p.strategyName}</Link></td>
                    <td className="text-right font-mono tabular-nums">{fmtNum(p.qty, 4)}</td>
                    <td className="text-right font-mono tabular-nums text-ink-2">{fmtUsd(p.avgEntry)}</td>
                    <td className="text-right font-mono tabular-nums">{p.markPrice == null ? <span className="font-sans text-muted">No mark</span> : fmtUsd(p.markPrice)}{p.notionalUsd != null && <div className="text-[11.5px] text-muted">{fmtUsd(p.notionalUsd)}</div>}</td>
                    <td className={`px-5 text-right font-mono tabular-nums ${p.unrealizedPnlUsd == null ? "text-muted" : tone(p.unrealizedPnlUsd)}`}>{p.unrealizedPnlUsd == null ? "—" : fmtUsd(p.unrealizedPnlUsd, { sign: true })}</td>
                  </tr>))}</tbody>
              </table>
            </div>)}
        </Card>
        <Card className="mt-3 overflow-hidden">
          <h2 className="px-5 pt-5 font-medium">Runs</h2>
          {runs.data.items.length === 0 ? <p className="p-5 text-[13.5px] text-muted">No paper runs yet. Start one from a strategy.</p> : (
            <div className="relative mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-[13px]" data-testid="pf-runs">
                <thead><tr className="text-left text-[12px] text-muted"><th className="px-5 py-2 font-normal">Run</th><th className="font-normal">Status</th><th className="text-right font-normal">Equity</th><th className="text-right font-normal">P&L</th><th className="text-right font-normal">Fills</th><th className="px-5 text-right font-normal"><span className="sr-only">Links</span></th></tr></thead>
                <tbody>{runs.data.items.map((r) => (
                  <tr key={r.runId} className="border-t border-line">
                    <td className="px-5 py-3"><div className="font-mono text-ink">…{r.runId.slice(-6)}</div><div className="text-[11.5px] text-muted">{day(r.startedAt)}</div></td>
                    <td className="text-ink-2">{RUN_STATUS[r.status] ?? r.status}</td>
                    <td className="text-right font-mono tabular-nums">{fmtUsd(r.equityUsd)}</td>
                    <td className={`text-right font-mono tabular-nums ${tone(r.pnlUsd)}`}>{fmtUsd(r.pnlUsd, { sign: true })}<div className="text-[11.5px]">{fmtPct(r.pnlPct, { sign: true })}</div></td>
                    <td className="text-right font-mono tabular-nums text-ink-2">{r.fills}</td>
                    <td className="whitespace-nowrap px-5 text-right"><Link className="underline" href={`/app/run/${r.runId}`}>Open</Link> · <Link className="underline" href={`/app/run/${r.runId}/replay`}>Replay</Link></td>
                  </tr>))}</tbody>
              </table>
            </div>)}
        </Card>
      </>)}
    </Wrap>
  );
}
