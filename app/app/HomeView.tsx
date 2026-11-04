"use client";
import EquityChart from "@/components/EquityChart";
import Link from "@/components/Link";
import PageHeader from "@/components/PageHeader";
import VenueMark from "@/components/VenueMark";
import { Card, Pill } from "@/components/ui";
import Loading from "@/components/Loading";
import { api, API_MODE, change24hTitle, fmtUsd, fmtPct, fmtAgo, fmtSource, tone, RUN_STATUS } from "@/lib/api";
import { useQ } from "@/lib/api/useQ";
import { decimal, usePaperAccount } from "@/lib/paper/use-paper-account";
import { SUGGESTIONS } from "@/lib/copy";

const runTone = { running: "long", starting: "muted", paused: "muted", stopped: "muted", halted: "short" } as const;

function Draft({ compact }: { compact?: boolean }) {
  return (
    <div className="q-draft-inline">
      {compact && <h2 className="mb-4 text-[15px] font-medium">Draft another</h2>}
      <form action="/app/new" className="q-focus-group flex items-center gap-2 rounded-[14px] border border-line-2 bg-card p-2 pl-4 focus-within:border-accent/50">
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

export default function HomeView() {
  const local = API_MODE === "mock";
  const workflows = usePaperAccount(true);
  const account = local || workflows?.sessions.length ? workflows : null;
  const watchlist = useQ(() => api.markets());
  const q = useQ(async () => {
    const [portfolio, strategies, runs] = await Promise.all([local ? null : api.portfolio("paper"), api.strategies(), api.runs()]);
    const first = runs.items.find(r => r.status === "running") ?? runs.items[0];
    const chart = first ? await api.equity(first.id, 120).catch(() => null) : null;
    return { portfolio, strategies, runs, chart };
  });
  const d = q.data;
  const pf = account ? {
    equityUsd: decimal(account.totals.equity), cashUsd: decimal(account.totals.cash),
    realizedPnlUsd: decimal(account.totals.realized), unrealizedPnlUsd: decimal(account.totals.unrealized),
    positions: account.positions.map(p => ({ instrument: p.id, symbol: p.symbol, venue: p.venue, qty: String(+p.qty.toFixed(6)), avgEntry: decimal(p.entry), markPrice: decimal(p.mark), unrealizedPnlUsd: decimal(p.unrealized) })),
    asOf: account.asOf === null ? null : new Date(account.asOf).toISOString(),
  } : d?.portfolio;
  if (!d || !pf) return <div className="q-page q-overview mx-auto max-w-[1180px] px-5 py-10 sm:px-8 sm:py-12"><PageHeader title="Overview" sub="Your paper workspace" /><Loading h={560} q={q} /></div>;
  const { strategies, runs, chart } = d;
  const markets = watchlist.data?.items ?? [];
  const now = Date.now();
  const byId = new Map(runs.items.map(r => [r.id, r]));
  const active = (account?.sessions ?? runs.items).filter(r => r.status === "running").length;
  const mine = strategies.items.slice(0, 3);
  const has = strategies.items.length > 0;
  const restricted = markets.slice(0, 5).some(m => m.geoRestricted);
  return (
    <div className="q-page q-overview mx-auto max-w-[1180px] px-5 py-10 sm:px-8 sm:py-12">
      <div className="q-overview-head"><div><div className="q-overview-title"><h1>Overview</h1><span className="q-mode"><i />Paper mode</span></div><p>{active ? `${active} paper session${active === 1 ? " is" : "s are"} running.` : "Your strategies, positions and paper balance in one place."}</p></div>{pf.asOf && <span className="q-overview-updated">Updated {fmtAgo(pf.asOf, now)}</span>}</div>
      {!has && <Draft />}
      <div className="q-metric-strip">
        {([["Paper equity", fmtUsd(pf.equityUsd), ""], ["Cash", fmtUsd(pf.cashUsd), ""], ["Realized PnL", fmtUsd(pf.realizedPnlUsd, { sign: true }), tone(pf.realizedPnlUsd)], ["Unrealized PnL", fmtUsd(pf.unrealizedPnlUsd, { sign: true }), tone(pf.unrealizedPnlUsd)]] as const).map(([k,v,c]) => <div key={k} className="q-metric"><span>{k}</span><strong className={c}>{v}</strong></div>)}
      </div>
      <EquityChart points={account?.history ?? chart?.points ?? []} synthetic={chart?.synthetic} />

      <section className="q-overview-section"><div className="q-overview-section-head"><h2>Open positions</h2><Link href="/app/portfolio">View portfolio</Link></div>
        <Card className="overflow-hidden"><div className="q-position-head"><span>Asset</span><span>Size</span><span>Entry</span><span>Current</span><span>PnL</span></div>
          {pf.positions.map(p => <div className="q-position-row" key={p.instrument}><span className="flex items-center gap-2">{p.venue && <VenueMark venue={p.venue} />}<span>{p.symbol}</span></span><span className="text-muted">{p.qty}</span><span className="text-muted">{fmtUsd(p.avgEntry)}</span><span>{p.markPrice == null ? "Waiting for price" : fmtUsd(p.markPrice)}</span><span className={tone(p.unrealizedPnlUsd)}>{fmtUsd(p.unrealizedPnlUsd,{sign:true})}</span></div>)}
          {!pf.positions.length && <p className="px-5 py-6 text-[13px] text-muted">No open positions yet. They appear when a paper trade fills.</p>}
        </Card>
      </section>
      <section className="q-overview-section"><div className="q-overview-section-head"><h2>Your strategies</h2><Link href="/app/strategies">View all</Link></div>
        {mine.length ? <div className="q-strategy-grid">{mine.map(s => {
          const paper = account?.sessions.find(v => v.strategyId === s.id);
          const r = s.activeRunId ? byId.get(s.activeRunId) : null;
          const href = paper ? "/app/run/" + paper.id : r ? "/app/run/" + r.id : "/app/new?strategy=" + encodeURIComponent(s.id);
          return <Link key={s.id} href={href} className="q-strategy-tile">
            <div className="flex items-center justify-between gap-3"><span className="flex gap-1">{s.venues.map(v=><VenueMark key={v} venue={v} size={16}/>)}</span>
            <Pill tone={r && !paper ? runTone[r.status] : "muted"}>{paper ? paper.status : r ? RUN_STATUS[r.status] : "Draft"}</Pill></div>
            <h3>{s.name}</h3><footer><span>{paper ? "Open session" : r ? fmtPct(r.pnlPct,{sign:true}) : "Open draft"}</span>
            <span>v{s.version} · {fmtAgo(s.updatedAt, now)}</span></footer>
          </Link>;
        })}</div> : <Card className="p-5 text-[13px] text-muted">{has ? "None of your strategies are running. Open one and paper-trade it." : "Nothing yet. Describe a trade above and Quiver drafts it."}</Card>}
      </section>
      {has && <Draft compact />}

      <div className="mt-12 flex items-center justify-between"><h2 className="text-[15px] font-medium">Watchlist</h2><Link href="/app/markets" className="inline-flex min-h-11 items-center text-[12.5px] text-muted hover:text-ink">All markets →</Link></div>
      <Card className="mt-4 divide-y divide-line">
        {!markets.length && <p className="p-5 text-[13px] text-muted">{watchlist.error ?? (watchlist.data ? "No markets to show." : "Loading markets…")}</p>}
        {markets.slice(0, 5).map((m) => (
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
