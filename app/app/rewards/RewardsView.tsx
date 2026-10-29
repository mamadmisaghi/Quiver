"use client";
// Rewards from api.rewards() (ext.ts RewardsRes, M3.1). Every number is EXAMPLE data: no program is live.
import PageHeader from "@/components/PageHeader";
import Wrap, { Stat, Stats } from "@/components/Wrap";
import { Card, Pill } from "@/components/ui";
import Loading from "@/components/Loading";
import { api } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";
const SUB = "Points for building and sharing. How points convert, if at all, is to be confirmed.";
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const n = (x: number) => x.toLocaleString();

export default function RewardsView() {
  const q = useQ(() => api.rewards());
  if (!q.data) return <Wrap><PageHeader title="Rewards" sub={SUB} /><Loading h={360} q={q} /></Wrap>;
  const r = q.data;
  const open = r.quests.filter((x) => !x.done).reduce((a, x) => a + x.points, 0);
  const pct = r.totalParticipants > 0 ? Math.max(1, Math.round((r.rank / r.totalParticipants) * 100)) : null;
  return (
    <Wrap>
      <PageHeader title="Rewards" sub={SUB} />
      {r.notice && <p className="mb-6 mt-3 flex items-start gap-2 text-[12.5px] text-muted"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted" aria-hidden />{r.notice}</p>}
      <Stats n={4}>
        <Stat k="Points" v={n(r.points)} />
        <Stat k="Rank" v={`#${n(r.rank)}`} />
        <Stat k="Participants" v={n(r.totalParticipants)} />
        <Stat k="Still to earn" v={n(open)} />
      </Stats>
      <p className="mt-3 text-[12.5px] text-muted">
        {r.season.name} · {day(r.season.startsAt)} – {day(r.season.endsAt)}{pct != null && <> · top {pct}%</>}
      </p>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <div className="border-b border-line px-6 py-4 font-medium">Quests</div>
          <ul>{r.quests.map((x) => (
            <li key={x.id} className="border-b border-line px-6 py-4 last:border-0">
              <div className="flex items-center justify-between gap-4">
                <span className={`flex items-center gap-3 text-[14px] ${x.done ? "text-muted" : ""}`}>
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[12px] ${x.done ? "border-long/50 text-long" : "border-line-2"}`}>{x.done ? "✓" : ""}</span>{x.title}
                </span>
                <span className="flex items-center gap-3"><span className="tnum font-mono text-[13px] text-muted">+{n(x.points)}</span><Pill tone={x.done ? "long" : "muted"}>{x.done ? "Done" : "Open"}</Pill></span>
              </div>
              {!x.done && (
                <div className="ml-8 mt-3 flex items-center gap-3">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[.06]" role="progressbar" aria-label={`${x.title} progress`} aria-valuenow={Math.round(x.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full bg-accent" style={{ width: `${x.progress * 100}%` }} />
                  </div>
                  <span className="tnum w-10 text-right font-mono text-[12px] text-muted">{Math.round(x.progress * 100)}%</span>
                </div>)}
            </li>))}
          </ul>
        </Card>
        <Card>
          <div className="border-b border-line px-6 py-4 font-medium">History</div>
          {r.history.length ? <ul>{[...r.history].reverse().map((h) => (
            <li key={h.at + h.reason} className="flex items-center justify-between gap-4 border-b border-line px-6 py-3.5 text-[13.5px] last:border-0">
              <span><span className="block">{h.reason}</span><span className="text-[12px] text-muted">{day(h.at)}</span></span>
              <span className="tnum font-mono text-long">+{n(h.points)}</span>
            </li>))}</ul> : <p className="px-6 py-8 text-[13.5px] text-muted">No points yet.</p>}
        </Card>
      </div>
    </Wrap>
  );
}
