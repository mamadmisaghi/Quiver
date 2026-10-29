"use client";
import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import Wrap from "@/components/Wrap";
import { Card } from "@/components/ui";
import Loading from "@/components/Loading";
import { api, DEMO_LABEL, errOf } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";
export default function RiskView() {
  const list = useQ(() => api.strategies());
  const [pick, setPick] = useState<string | null>(null);
  const id = pick ?? list.data?.items[0]?.id ?? null;
  const rec = useQ(() => (id ? api.strategy(id) : Promise.resolve(null)), [id]);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const sw = list.data && list.data.items.length > 0 && (
    <label className="flex items-center gap-2 text-[13px] text-muted">Strategy
      <select value={id ?? ""} onChange={(e) => setPick(e.target.value)} className="rounded-full border border-line-2 bg-card px-3 py-1.5 text-[13px] text-ink focus:border-accent/50 focus:outline-none">
        {list.data.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </label>);
  const r = rec.data?.strategy.risk;
  if (list.data && !list.data.items.length) return <Wrap><PageHeader title="Risk limits" sub="Draft a strategy first — its limits show up here." /></Wrap>;
  if (!r || !rec.data) return <Wrap><PageHeader title="Risk limits" sub={DEMO_LABEL} right={sw} /><Loading h={420} q={list.error ? list : rec} /></Wrap>;
  const run = rec.data.activeRunId;
  const L: [string, string, string][] = [
    ["Max position", `${r.maxPositionPct}% of equity`, "Any single position above this is refused."],
    ["Max total exposure", `${r.maxTotalExposurePct}% of equity`, "All open positions across venues, combined."],
    ["Daily loss halt", `${r.maxDailyLossPct}%`, "Losing this much in a day pauses the run until you resume it."],
    ["Max orders per day", String(r.maxOrdersPerDay), "Counted across every action in the strategy."],
    ["Trading hours", r.tradingHours ? `${r.tradingHours.from}–${r.tradingHours.to} ${r.tradingHours.tz}` : "Any time", "Orders outside this window wait."],
    ["When stock prices are stale", r.equityWhenFeedStale === "skip" ? "Skip the trade" : "Use the pool's average price", "Applies while the stock market is closed."],
  ];
  const flatten = async () => {
    if (!run) return;
    try { await api.control(run, "stop_and_flatten"); setMsg("Stopped. Paper positions closed."); } catch (x) { setMsg(errOf(x, "Couldn't stop the run.")); }
    setConfirm(false);
  };
  return (
    <Wrap>
      <PageHeader title="Risk limits" sub={`Limits on “${rec.data.name}” (v${rec.data.version}). The AI can't draft around them.`} right={sw} />
      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {L.map(([k, v, d]) => (
          <Card key={k} className="group p-6">
            <div className="flex items-center justify-between"><div className="text-[13px] text-muted">{k}</div>
              <a href={`/app/new?q=${encodeURIComponent(`Change ${k.toLowerCase()} on “${rec.data!.name}” to `)}`} className="rounded-full px-2 py-0.5 text-[12.5px] text-muted hover:bg-white/5 hover:text-ink" aria-label={`Edit ${k}`}>Edit</a></div>
            <div className="tnum mt-3 font-mono text-[24px] tracking-[-0.02em]">{v}</div>
            <p className="mt-3 text-[13.5px] text-muted">{d}</p>
          </Card>
        ))}
      </div>
      <Card className="mt-6 border-short/30 p-6">
        <div className="flex items-center justify-between gap-6">
          <div><div className="font-medium">Stop and flatten</div><p className="mt-1 text-[14px] text-muted">{run ? "Stops this run and closes its paper positions at market." : "This strategy isn't running."}</p></div>
          {!confirm && <button disabled={!run} onClick={() => setConfirm(true)} className="btn shrink-0 rounded-full border border-short/50 px-4 py-2 text-[13px] text-short hover:bg-short/10 disabled:opacity-40">Stop and flatten</button>}
        </div>
        {confirm && (
          <div role="alertdialog" aria-label="Confirm stop and flatten" className="mt-5 flex flex-col gap-3 rounded-[12px] border border-short/30 bg-short/[.06] p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13.5px] text-ink-2">Close every open position in “{rec.data.name}” now? You can&apos;t undo this.</p>
            <div className="flex shrink-0 gap-2"><button onClick={() => setConfirm(false)} className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] hover:bg-white/5">Cancel</button>
              <button onClick={flatten} className="btn rounded-full bg-short px-4 py-2 text-[13px] font-medium text-bg">Yes, stop and flatten</button></div>
          </div>)}
        {msg && <p role="status" className="mt-3 text-[13px] text-muted">{msg}</p>}
      </Card>
    </Wrap>
  );
}
