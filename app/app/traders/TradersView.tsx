"use client";
import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import VenueMark from "@/components/VenueMark";
import Wrap, { Th } from "@/components/Wrap";
import { Card, Pill, Spark } from "@/components/ui";
import Loading from "@/components/Loading";
import { api, fmtPct, tone } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";
import HandleLink from "@/components/social/Handle";
const W = [["7d", "7 days"], ["30d", "30 days"], ["all", "All time"]] as const;
export default function TradersView() {
  const [w, setW] = useState<"7d" | "30d" | "all">("30d");
  const q = useQ(() => api.traders(w), [w]);
  const tabs = <div className="flex gap-1" role="tablist">{W.map(([k, l]) => <button key={k} role="tab" aria-selected={w === k} onClick={() => setW(k)} className={`btn rounded-full px-3.5 py-1.5 text-[13px] ${w === k ? "bg-white/[.08] text-ink" : "text-muted hover:text-ink"}`}>{l}</button>)}</div>;
  const sub = "Ranked by paper return. Paper results don't predict live results.";
  if (!q.data) return <Wrap><PageHeader title="Traders" sub={sub} right={tabs} /><Loading h={420} q={q} /></Wrap>;
  const lb = q.data;
  return (
    <Wrap>
      <PageHeader title="Traders" sub={sub} right={tabs} />
      {/* M5.18: copying an external wallet address is not built yet (backend answers 501 not_available) — labeled, never called */}
      <p data-testid="ext-copy-soon" className="mt-6 flex flex-wrap items-center gap-2 text-[13px] text-muted"><span className="rounded-full border border-line-2 px-2 py-0.5 font-mono text-[11.5px] uppercase tracking-[.14em]">Coming soon</span>Copy any external wallet address. For now, copy a Quiver trader’s public strategy to paper.</p>
      <Card className="mt-6 overflow-x-auto">
        <table className="rtable w-full min-w-[820px] text-left text-[13.5px]">
          <Th cols={["#", "Trader", "Venues", "Paper return", "sr:Trend", "Win rate", "Strategies"]} />
          <tbody>{lb.items.map((t) => (
            <tr key={t.handle} className={`border-b border-line last:border-0 ${t.isYou ? "bg-white/[.03]" : "hover:bg-white/[.02]"}`}>
              <td data-label="#" className="tnum px-5 py-4 font-mono text-muted">{t.rank}</td>
              <td data-label="Trader" className="px-5 font-mono"><HandleLink handle={t.handle} />{t.isYou && <span className="ml-2"><Pill>You</Pill></span>}</td>
              <td data-label="Venues" className="px-5"><span className="flex gap-1">{t.venues.map((v) => <VenueMark key={v} venue={v} />)}</span></td>
              <td data-label="Paper return" className={`tnum px-5 font-mono ${tone(t.paperReturnPct)}`}>{fmtPct(t.paperReturnPct, { sign: true, dp: 1 })}</td>
              <td className="px-5">{t.spark.length > 1 && <Spark pts={t.spark} w={90} h={22} tone={tone(t.paperReturnPct) === "text-short" ? "short" : "long"} />}</td>
              <td data-label="Win rate" className="tnum px-5 font-mono text-ink-2">{fmtPct(t.winRatePct, { dp: 0 })}</td>
              <td data-label="Strategies" className="tnum px-5 font-mono text-ink-2">{t.strategies}</td>
            </tr>))}
            {!lb.items.length && <tr><td colSpan={7} className="px-5 py-10 text-center text-muted">No ranked traders yet for this window.</td></tr>}
          </tbody>
        </table>
      </Card>
      {lb.notice && <p className="mt-6 text-[12px] text-muted">{lb.notice}</p>}
    </Wrap>
  );
}
