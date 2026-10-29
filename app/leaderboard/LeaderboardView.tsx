"use client";
// M4.8: public leaderboard (GET /v1/public/leaderboard, no auth). Live data is the hero; notice always visible.
import { useEffect, useState } from "react";
import Link from "@/components/Link";
import { api, fmtPct, type PublicBoard, errOf } from "@/lib/api";
import VenueMark from "@/components/VenueMark";
import { Pill, Spark } from "@/components/ui";
import HandleLink from "@/components/social/Handle";

const PERIODS = [["7d", "7 days"], ["30d", "30 days"], ["all", "All time"]] as const;
type Period = (typeof PERIODS)[number][0];
const tone = (v: string | null) => (v == null ? "" : Number(v) > 0 ? "text-long" : Number(v) < 0 ? "text-short" : "");

export default function LeaderboardView({ initial = null }: { initial?: PublicBoard | null }) {
  const [p, setP] = useState<Period>("7d");
  const [st, setSt] = useState<{ p: Period; d?: PublicBoard; err?: string } | null>(initial ? { p: "7d", d: initial } : null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let on = true;
    api.publicLeaderboard({ period: p, limit: 50 }).then((d) => on && setSt({ p, d }), (e) => on && setSt({ p, err: errOf(e, "Couldn’t load the leaderboard.") }));
    return () => { on = false; };
  }, [p, n]);
  const cur = st?.p === p ? st : null, d = cur?.d;
  return (
    <div data-motion="leaderboard">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-muted">Leaderboard</p>
          <h1 className="mt-3 text-[30px] font-medium tracking-tight sm:text-[40px]">Who’s up, in plain numbers</h1>
        </div>
        <div role="tablist" aria-label="Period" className="flex rounded-full border border-line-2 p-1">
          {PERIODS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={p === k} onClick={() => setP(k)} className={`btn rounded-full px-4 py-1.5 text-[13px] ${p === k ? "bg-ink text-bg" : "text-ink-2 hover:text-ink"}`}>{l}</button>
          ))}
        </div>
      </div>
      {d && (
        <div className="mt-5 flex flex-wrap items-start gap-2 rounded-lg border border-line bg-bg-2 px-4 py-3 text-[13px] text-ink-2" role="note" data-testid="lb-notice">
          {d.synthetic && <Pill tone="warn">Synthetic</Pill>}
          <span className="min-w-0 flex-1">{d.notice}{d.minTrades > 0 && <> Minimum {d.minTrades} trades to rank.</>}</span>
        </div>
      )}
      <div className="mt-6 overflow-hidden rounded-xl border border-line" aria-busy={!cur}>
        {!cur && <div className="h-[420px] animate-pulse bg-bg-2 motion-reduce:animate-none"><span className="sr-only">Loading leaderboard</span><noscript><p className="p-8 text-center text-[14px] text-ink-2">The leaderboard needs JavaScript to load right now. Paper and backtest results only, on synthetic prices. Not real money.</p></noscript></div>}
        {cur?.err && <div className="p-8 text-center text-[14px] text-ink-2" role="status">{cur.err} <button className="btn ml-2 underline" onClick={() => setN((x) => x + 1)}>Try again</button></div>}
        {d && d.items.length === 0 && <div className="p-10 text-center text-[14px] text-ink-2" role="status">No ranked runs in this period yet. <Link className="underline" href="/app/new">Write a strategy</Link> and paper-trade it to get on the board.</div>}
        {d && d.items.length > 0 && (
          <table className="w-full text-left text-[13.5px]" data-testid="lb-table">
            <caption className="sr-only">Leaderboard, {PERIODS.find((x) => x[0] === p)![1]}</caption>
            <thead className="border-b border-line bg-bg-2 text-[12px] text-muted">
              <tr>
                <th scope="col" className="w-10 px-3 py-2.5 font-normal sm:px-4">#</th>
                <th scope="col" className="px-3 py-2.5 font-normal">Strategy</th>
                <th scope="col" className="hidden px-3 py-2.5 font-normal md:table-cell">Venues</th>
                <th scope="col" className="hidden px-3 py-2.5 font-normal lg:table-cell">Basis</th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">Return</th>
                <th scope="col" className="hidden px-3 py-2.5 text-right font-normal md:table-cell">Max DD</th>
                <th scope="col" className="hidden px-3 py-2.5 text-right font-normal lg:table-cell">Win rate</th>
                <th scope="col" className="hidden px-3 py-2.5 text-right font-normal sm:table-cell">Trades</th>
                <th scope="col" className="hidden w-[132px] px-3 py-2.5 font-normal sm:table-cell sm:px-4"><span className="sr-only">Trend</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.items.map((r) => (
                <tr key={r.rank + r.publicStrategyId} className="align-middle">
                  <td className="tnum px-3 py-3 font-mono text-muted sm:px-4">{r.rank}</td>
                  <td className="max-w-0 px-3 py-3">
                    <div className="truncate font-medium text-ink">{r.strategyName}</div>
                    <div className="truncate text-[12px] text-muted"><HandleLink handle={r.handle} /><span className="lg:hidden"> · {r.basis}</span></div>
                  </td>
                  <td className="hidden px-3 py-3 md:table-cell"><div className="flex gap-1">{r.venues.map((v) => <VenueMark key={v} venue={v} size={18} />)}</div></td>
                  <td className="hidden px-3 py-3 lg:table-cell"><Pill tone={r.basis === "paper" ? "paper" : "muted"}>{r.basis === "paper" ? "Paper" : "Backtest"}</Pill></td>
                  <td className={`tnum px-3 py-3 text-right font-mono ${tone(r.returnPct)}`}>{fmtPct(r.returnPct, { sign: true })}</td>
                  <td className="tnum hidden px-3 py-3 text-right font-mono text-ink-2 md:table-cell">{r.maxDrawdownPct == null ? "—" : fmtPct(r.maxDrawdownPct)}</td>
                  <td className="tnum hidden px-3 py-3 text-right font-mono text-ink-2 lg:table-cell">{r.winRatePct == null ? "—" : fmtPct(r.winRatePct)}</td>
                  <td className="tnum hidden px-3 py-3 text-right font-mono text-ink-2 sm:table-cell">{r.trades}</td>
                  <td className="hidden px-3 py-3 sm:table-cell sm:px-4">{r.spark.length > 1 && <Spark pts={r.spark} w={110} h={28} tone={Number(r.returnPct) >= 0 ? "long" : "short"} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {d && <p className="tnum mt-3 text-[12px] text-muted">As of {new Date(d.asOf).toUTCString().slice(5, 22)} UTC · returns are percentages, never dollar amounts.</p>}
    </div>
  );
}
