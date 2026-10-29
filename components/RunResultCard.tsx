"use client";
// M3.8: GET /v1/runs/:id/card — the summary shown once a run has stopped.
import { useEffect, useState } from "react";
import { api, fmtPct, fmtUsd, type RunCard, errOf } from "@/lib/api";
import { Card, Pill, Spark } from "./ui";
import ShareCard from "./ShareCard";

const dur = (s: number) => (s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.max(1, Math.round(s / 60))}m`);
export default function RunResultCard({ runId }: { runId: string }) {
  const [c, setC] = useState<RunCard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    api.runCard(runId).then((x) => on && setC(x), (e) => on && setErr(errOf(e, "Couldn’t load the result card.")));
    return () => { on = false; };
  }, [runId]);
  if (err) return <Card className="mt-5 p-5 text-[13.5px] text-muted" role="status">{err}</Card>;
  if (!c) return <Card className="mt-5 h-[168px] animate-pulse bg-bg-2 motion-reduce:animate-none" aria-busy="true"><span className="sr-only">Loading result card</span></Card>;
  const up = Number(c.pnlUsd) >= 0;
  const stats: [string, string, string][] = [
    ["PnL", `${fmtUsd(c.pnlUsd, { sign: true })} · ${fmtPct(c.pnlPct, { sign: true })}`, up ? "text-long" : "text-short"],
    ["Equity", fmtUsd(c.equityUsd), ""], ["Max drawdown", fmtPct(c.maxDrawdownPct), ""],
    ["Fills", String(c.fills), ""], ["Trigger fires", String(c.triggerFires), ""], ["Fees", fmtUsd(c.feesUsd), ""], ["Ran for", dur(c.durationSec), ""],
  ];
  return (
    <Card className="mt-5 overflow-hidden bg-bg-2" data-testid="run-card" data-motion="run-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="text-[14px] font-medium">Result · {c.name}</h2>
        <div className="flex gap-1.5">{c.synthetic && <Pill tone="warn">Synthetic</Pill>}<Pill tone="accent">{c.mode === "paper" ? "Paper" : c.mode}</Pill></div>
      </div>
      <div className="grid gap-5 p-5 md:grid-cols-[1fr_16rem] md:items-center">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {stats.map(([k, v, cl]) => <div key={k} className="min-w-0"><dt className="text-[12px] text-muted">{k}</dt><dd className={`tnum mt-0.5 truncate font-mono text-[14px] ${cl}`}>{v}</dd></div>)}
        </dl>
        {c.spark.length > 1 && <Spark pts={c.spark} w={256} h={56} fluid tone={up ? "long" : "short"} />}
      </div>
      <ShareCard runId={runId} />
      <p className="border-t border-line px-5 py-2.5 text-[12px] text-muted">{c.disclaimer}</p>
    </Card>
  );
}
