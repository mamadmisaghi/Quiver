"use client";
import Link from "@/components/Link";
import PageHeader from "@/components/PageHeader";
import Wrap, { Stat, Stats, Th } from "@/components/Wrap";
import { Card } from "@/components/ui";
import Loading from "@/components/Loading";
import { api, fmtUsd, fmtPct } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";
const SUB = "What you earn when others fork your public strategies. The fee split is to be confirmed.";
export default function RevenueView() {
  const q = useQ(() => api.revenue());
  if (!q.data) return <Wrap><PageHeader title="Revenue" sub={SUB} /><Loading h={360} q={q} /></Wrap>;
  const r = q.data;
  return (
    <Wrap>
      <PageHeader title="Revenue" sub={SUB} />
      <p data-testid="rev-accounting" className="mt-2"><span className="whitespace-nowrap rounded-[4px] border border-line-2 px-1.5 py-0.5 font-mono text-[11.5px] text-muted">{r.accounting === "paper_ledger" ? "Paper ledger" : "Accounting off"}</span></p>
      <Stats><Stat k="Earned" v={fmtUsd(r.earnedUsd)} /><Stat k="Claimable" v={fmtUsd(r.claimableUsd)} /><Stat k="Forks" v={String(r.forks)} /><Stat k="Creator share" v={r.creatorSharePct == null ? "To be confirmed" : fmtPct(r.creatorSharePct, { dp: 0 })} /></Stats>
      <Card className="mt-6 overflow-x-auto">
        <table className="rtable w-full min-w-[640px] text-left text-[13.5px]"><Th cols={["Strategy", "Forks", "Followers' volume", "Earned"]} />
          <tbody>
            {r.rows.map((x) => <tr key={x.strategyId} className="border-b border-line last:border-0"><td data-label="Strategy" className="px-5 py-4">{x.name}</td><td data-label="Forks" className="tnum px-5 font-mono">{x.forks}</td><td data-label="Followers' volume" className="tnum px-5 font-mono">{fmtUsd(x.followersVolumeUsd)}</td><td data-label="Earned" className="tnum px-5 font-mono">{fmtUsd(x.earnedUsd)}</td></tr>)}
            {!r.rows.length && <tr><td colSpan={4} className="px-5 py-14 text-center text-muted">Publish a strategy to start earning. <Link href="/app/strategies" className="text-ink underline decoration-white/30 underline-offset-2 hover:decoration-current">Your strategies →</Link></td></tr>}
          </tbody>
        </table>
      </Card>
      <button disabled className="btn mt-6 rounded-full border border-line-2 px-4 py-2 text-[13px] text-muted opacity-50">Claim · not available yet</button>
      {r.notice && <p className="mt-4 text-[12px] text-muted">{r.notice}</p>}
    </Wrap>
  );
}
