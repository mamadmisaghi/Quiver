"use client";
import Link from "@/components/Link";
import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import VenueMark from "@/components/VenueMark";
import { Th } from "@/components/Wrap";
import { Card, Pill, Spark } from "@/components/ui";
import Loading from "@/components/Loading";
import { api, fmtPct, fmtUsd, fmtAgo, tone, RUN_STATUS, DEMO_LABEL } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";
import HandleLink from "@/components/social/Handle";
import CopyDialog from "@/components/social/CopyDialog";
const runTone = { running: "long", starting: "muted", paused: "muted", stopped: "muted", halted: "short" } as const;
type F = "all" | "draft" | "invalid";
export default function StrategiesView() {
  const [f, setF] = useState<F>("all");
  const [copying, setCopying] = useState<{ id: string; name: string; handle: string } | null>(null);
  const q = useQ(async () => { const [s, runs, pub] = await Promise.all([api.strategies(), api.runs(), api.publicStrategies({ sort: "return_30d" })]); return { s, runs, pub, now: Date.now() }; });
  const header = <PageHeader title="Strategies" sub={`Everything you've drafted or are paper-trading · ${DEMO_LABEL}`}
    right={<Link href="/app/new" className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] hover:border-white/30 hover:bg-white/5">+ New strategy</Link>} />;
  if (!q.data) return <div className="mx-auto max-w-[1180px] px-5 py-10 sm:px-8 sm:py-12">{header}<Loading h={420} q={q} /></div>;
  const { s, runs, pub, now } = q.data;
  const byId = new Map(runs.items.map((r) => [r.id, r]));
  const n = (st: string) => s.items.filter((x) => x.status === st).length;
  const rows = s.items.filter((x) => f === "all" || x.status === f);
  return (
    <div className="mx-auto max-w-[1180px] px-5 py-10 sm:px-8 sm:py-12">
      {header}
      <div className="mt-8 flex flex-wrap items-center gap-2" role="tablist">
        {([["all", `All ${s.items.length}`], ["draft", `Drafts ${n("draft")}`], ["invalid", `Needs fixes ${n("invalid")}`]] as const).map(([k, t]) => (
          <button key={k} role="tab" aria-selected={f === k} onClick={() => setF(k)} className={`btn rounded-full px-3.5 py-1.5 text-[13px] ${f === k ? "bg-white/[.08] text-ink" : "text-muted hover:text-ink"}`}>{t}</button>
        ))}
      </div>
      <Card className="mt-5 overflow-x-auto">
        <table className="rtable w-full min-w-[860px] text-left text-[13.5px]">
          <Th cols={["Strategy", "Venues", "Status", "Run", "Paper equity", "PnL", "Updated", "sr:Actions"]} />
          <tbody>
            {rows.map((x) => { const r = x.activeRunId ? byId.get(x.activeRunId) : undefined; return (
              <tr key={x.id} className="group border-b border-line last:border-0 hover:bg-white/[.02]">
                <td data-label="Strategy" className="px-5 py-4"><Link href={r ? `/app/run/${r.id}` : `/app/new?strategy=${encodeURIComponent(x.id)}`} className="font-medium hover:text-ink-2">{x.name}</Link><div className="font-mono text-[12px] text-muted">v{x.version}</div></td>
                <td data-label="Venues" className="px-5"><span className="flex gap-1">{x.venues.map((v) => <VenueMark key={v} venue={v} />)}</span></td>
                <td data-label="Status" className="px-5">{x.status === "invalid" ? <Pill tone="short">Invalid</Pill> : x.status === "draft" ? <Pill>Draft</Pill> : <span className="text-muted">—</span>}</td>
                <td data-label="Run" className="px-5">{r ? <Pill tone={runTone[r.status]}>Paper · {RUN_STATUS[r.status]}</Pill> : <span className="text-muted">—</span>}</td>
                <td data-label="Paper equity" className="tnum px-5 font-mono">{r ? fmtUsd(r.equityUsd) : "—"}</td>
                <td data-label="PnL" className={`tnum px-5 font-mono ${tone(r?.pnlPct)}`}>{r ? fmtPct(r.pnlPct, { sign: true }) : "—"}</td>
                <td data-label="Updated" className="tnum px-5 font-mono text-muted">{fmtAgo(x.updatedAt, now)}</td>
                <td className="px-5 text-right"><Link href={r ? `/app/run/${r.id}` : `/app/new?strategy=${encodeURIComponent(x.id)}`} className="text-[13px] text-muted group-hover:text-ink">{r ? "Open run →" : "Edit →"}</Link></td>
              </tr>); })}
            {!rows.length && <tr><td colSpan={8} className="px-5 py-10 text-center text-muted">{s.items.length ? "Nothing in this filter." : "No strategies yet. Draft one from a sentence."}</td></tr>}
          </tbody>
        </table>
      </Card>

      <h2 className="mt-12 text-[15px] font-medium">Public strategies</h2>
      <p className="mt-1 text-[13.5px] text-muted">Shared by other traders. Fork one to paper-trade your own copy.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {pub.items.slice(0, 6).map((p) => (
          <Card key={p.id} className="flex flex-col p-5">
            <div className="flex items-center justify-between"><span className="flex gap-1">{p.venues.map((v) => <VenueMark key={v} venue={v} />)}</span><span className={`tnum font-mono text-[13px] ${tone(p.paperReturn30dPct)}`}>{fmtPct(p.paperReturn30dPct, { sign: true, dp: 1 })} <span className="text-muted">30d</span></span></div>
            <Link href={`/app/strategies/${encodeURIComponent(p.id)}`} className="mt-5 text-[15px] font-medium hover:text-ink-2" data-testid="pub-open">{p.name}<span className="sr-only"> — view rules</span></Link>
            <div className="mt-1 font-mono text-[12px] text-muted">by <HandleLink handle={p.author.handle} /> · {p.forks} forks</div>
            {!p.author.isYou && <button onClick={() => setCopying({ id: p.id, name: p.name, handle: p.author.handle })} className="btn mt-4 self-start rounded-full border border-line-2 px-4 py-1.5 text-[13px] hover:bg-white/5" data-testid="copy-open">Copy to paper…</button>}
            {p.spark.length > 1 && <div className="mt-4"><Spark pts={p.spark} w={300} h={36} fluid tone={tone(p.paperReturn30dPct) === "text-short" ? "short" : "long"} /></div>}
          </Card>
        ))}
      </div>
      {copying && <CopyDialog publicStrategyId={copying.id} name={copying.name} handle={copying.handle} onClose={() => setCopying(null)} />}
    </div>
  );
}
