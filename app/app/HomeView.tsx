"use client";
import { useSyncExternalStore } from "react";
import Link from "@/components/Link";
import PageHeader from "@/components/PageHeader";
import VenueMark from "@/components/VenueMark";
import { Card, Pill, Spark } from "@/components/ui";
import Loading from "@/components/Loading";
import { api, change24hTitle, fmtUsd, fmtPct, fmtAgo, fmtSource, tone, RUN_STATUS, DEMO_LABEL } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";
import { SUGGESTIONS } from "@/lib/copy";

const runTone = { running: "long", starting: "muted", paused: "muted", stopped: "muted", halted: "short" } as const;

function Draft({ compact }: { compact?: boolean }) {
  return (
    <div className={compact ? "mt-12" : "mt-8"}>
      {compact && <h2 className="mb-4 text-[15px] font-medium">Draft another</h2>}
      <form action="/app/new" className="flex items-center gap-2 rounded-[14px] border border-line-2 bg-card p-2 pl-4 focus-within:border-accent/50">
        <label htmlFor="q" className="sr-only">Describe a trade</label>
        <input id="q" name="q" placeholder="Describe your next trade…" className="min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-muted focus:outline-none" />
        <button className="btn rounded-full bg-raised px-4 py-2 text-[13px] hover:bg-white/15">Draft</button>
      </form>
      <div className="mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none]">
        {SUGGESTIONS.map((s) => <Link key={s} href={`/app/new?q=${encodeURIComponent(s)}`} className="btn shrink-0 rounded-full border border-line px-3 py-1.5 text-[12.5px] text-muted hover:text-ink">{s}</Link>)}
      </div>
    </div>
  );
}

const noSub = () => () => {};
const greeting = () => { const h = new Date().getHours(); return h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening."; };
export default function HomeView() {
  const q = useQ(async () => {
    const [pf, strategies, runs, markets, me] = await Promise.all([api.portfolio("paper"), api.strategies(), api.runs(), api.markets(), api.me()]);
    const first = runs.items.find((r) => r.status === "running") ?? runs.items[0];
    const eq = first ? await api.equity(first.id, 120).catch(() => null) : null;
    return { pf, strategies, runs, markets, me, eq, now: Date.now() };
  });
  const d = q.data;
  const hello = useSyncExternalStore(noSub, greeting, () => "Welcome back.");
  if (!d) return <div className="mx-auto max-w-[1180px] px-5 py-10 sm:px-8 sm:py-12"><PageHeader title={hello} sub={DEMO_LABEL} /><Loading h={560} q={q} /></div>;
  const { pf, strategies, runs, markets, me, eq, now } = d;
  const byId = new Map(runs.items.map((r) => [r.id, r]));
  const active = runs.items.filter((r) => r.status === "running").length;
  const mine = strategies.items.filter((s) => s.activeRunId).slice(0, 3);
  const has = strategies.items.length > 0;
  const restricted = markets.items.slice(0, 5).some((m) => m.geoRestricted);
  return (
    <div className="mx-auto max-w-[1180px] px-5 py-10 sm:px-8 sm:py-12">
      <PageHeader title={hello} sub={`${active} ${active === 1 ? "strategy" : "strategies"} running on paper · ${Math.max(0, me.quotas.compilesPerDay - me.quotas.compilesUsedToday)} drafts left today · ${DEMO_LABEL}`}
        right={<Link href="/app/new" className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] hover:border-white/30 hover:bg-white/5">+ New strategy</Link>} />

      {!has && <Draft />}

      <Card className="mt-10 overflow-hidden">
        <div className="grid gap-px bg-line md:grid-cols-4">
          {([["Paper equity", fmtUsd(pf.equityUsd), "", true], ["Cash", fmtUsd(pf.cashUsd), "", false], ["Realized PnL", fmtUsd(pf.realizedPnlUsd, { sign: true }), tone(pf.realizedPnlUsd), false], ["Unrealized PnL", fmtUsd(pf.unrealizedPnlUsd, { sign: true }), tone(pf.unrealizedPnlUsd), false]] as const).map(([k, v, c, big]) => (
            <div key={k} className="bg-card px-6 py-5"><div className="text-[12.5px] text-muted">{k}</div><div className={`tnum mt-1.5 font-mono tracking-[-0.02em] ${big ? "text-[30px]" : "text-[22px]"} ${c}`}>{v}</div></div>
          ))}
        </div>
        {eq && eq.points.length > 1 && (
          <div className="border-t border-line px-6 pb-4 pt-5">
            <Spark pts={eq.points.map((p) => Number(p.equityUsd))} w={1000} h={96} fluid draw tone={Number(eq.points.at(-1)!.equityUsd) >= Number(eq.startingEquityUsd) ? "long" : "short"} />
            <div className="mt-2 flex justify-between font-mono text-[12px] text-muted"><span>{fmtAgo(eq.points[0].ts, now)}</span><span>Paper equity{eq.synthetic ? " · simulated prices" : ""}</span><span>now</span></div>
          </div>
        )}
      </Card>
      <p className="mt-2 font-mono text-[12px] text-muted">Updated {fmtAgo(pf.asOf, now)}</p>

      <h2 className="mt-8 text-[15px] font-medium">Open positions</h2>
      <Card className="mt-4 divide-y divide-line">
        {pf.positions.map((p) => (
          <div key={p.instrument} className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-3.5 sm:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div className="flex items-center gap-3"><VenueMark venue={p.venue} /><span className="font-mono text-[13.5px]">{p.symbol}</span></div>
            <div className="tnum hidden font-mono text-[13px] text-muted sm:block">{p.qty} @ {fmtUsd(p.avgEntry)}</div>
            <div className="tnum hidden font-mono text-[13px] sm:block">{p.markPrice == null ? <span className="text-muted">Waiting for price</span> : fmtUsd(p.markPrice)}</div>
            <div className={`tnum text-right font-mono text-[13px] ${tone(p.unrealizedPnlUsd)}`}>{fmtUsd(p.unrealizedPnlUsd, { sign: true })}</div>
          </div>
        ))}
        {!pf.positions.length && <div className="px-5 py-5 text-[13.5px] text-muted">No open positions yet. They appear when a paper trade fills.</div>}
      </Card>

      <h2 className="mt-12 text-[15px] font-medium">Your strategies</h2>
      {mine.length ? (
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {mine.map((s) => { const r = byId.get(s.activeRunId!); return (
            <Link key={s.id} href={`/app/run/${s.activeRunId}`} className="btn rounded-[14px] border border-line bg-card p-5 hover:-translate-y-0.5 hover:border-line-2">
              <div className="flex items-center justify-between"><div className="flex gap-1">{s.venues.map((v) => <VenueMark key={v} venue={v} />)}</div>{r && <Pill tone={runTone[r.status]}>{RUN_STATUS[r.status]}</Pill>}</div>
              <div className="mt-6 text-[15.5px] font-medium">{s.name}</div>
              <div className="mt-3 flex items-end justify-between">
                <span className={`tnum font-mono text-[13px] ${tone(r?.pnlPct)}`}>{r ? fmtPct(r.pnlPct, { sign: true }) : "—"}</span>
                <span className="font-mono text-[12px] text-muted">v{s.version} · {fmtAgo(s.updatedAt, now)}</span>
              </div>
            </Link>); })}
        </div>
      ) : <Card className="mt-4 px-5 py-5 text-[13.5px] text-muted">{has ? "None of your strategies are running. Open one and paper-trade it." : "Nothing yet. Describe a trade above and Quiver drafts it."}</Card>}

      {has && <Draft compact />}

      <div className="mt-12 flex items-center justify-between"><h2 className="text-[15px] font-medium">Watchlist</h2><Link href="/app/markets" className="inline-flex min-h-11 items-center text-[12.5px] text-muted hover:text-ink">All markets →</Link></div>
      <Card className="mt-4 divide-y divide-line">
        {markets.items.slice(0, 5).map((m) => (
          <div key={m.id} className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-3.5 sm:grid-cols-[1.4fr_1fr_1fr]">
            <div className="flex items-center gap-3"><VenueMark venue={m.venue} /><div><div className="flex items-center gap-2 font-mono text-[13.5px]">{m.symbol}{m.geoRestricted && <Pill>Restricted*</Pill>}</div><div className="text-[12px] text-muted">{m.name}</div></div></div>
            <div className="hidden text-[12.5px] text-muted sm:block">{fmtSource(m.priceSource, m.priceAt, now)}</div>
            <div className="tnum text-right font-mono text-[13.5px] sm:text-left">{fmtUsd(m.price)}<span title={change24hTitle(m.change24hPct, m.change24hSource)} className={`ml-2 ${tone(m.change24hPct)}`}>{fmtPct(m.change24hPct, { sign: true, dp: 1 })}</span></div>
          </div>
        ))}
      </Card>
      {restricted && <p className="mt-3 text-[12px] text-muted">* Stock tokens aren&apos;t available to US persons or in restricted regions. You can still watch them and use them as signals.</p>}
    </div>
  );
}
