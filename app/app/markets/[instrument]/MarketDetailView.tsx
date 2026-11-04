"use client";
// M5.1 market detail on GET /markets/:id/detail + /history (backend 82dfa59). Positions come from GET /positions.
// "Strategies on this market" is PROPOSED — awaiting Sage (see PROPOSED-API.md). // MOCK
// The live quote is the hero: it re-reads GET /markets every 5s and flashes on change (data-motion="price-tick" for Ellis).
import { onSession } from "@/lib/api/session";
import Link from "@/components/Link";
import { useEffect, useState } from "react";
import HistoryChart,{chartBars,hasCandles} from "@/components/charts/HistoryChart";
import QuoteNumber from "@/components/charts/QuoteNumber";
import VenueMark from "@/components/VenueMark";
import SignInButton from "@/components/SignInButton";
import { Card, Pill } from "@/components/ui";
import { api, ApiErr, errCopy, fmtPct, fmtUsd, fmtSource, warmupMsg, WARMUP_SHORT, tone, type Market, type MarketDetailRes, type MarketHistoryRes, type MarketStrategyRef, type OpenPosition } from "@/lib/api";
import { CHART_RANGES, publicRefs } from "@/lib/api/market-mock";

const KIND: Record<string, string> = { token: "Token", perp: "Perp", spot: "Spot", outcome: "Outcome" };
const SESSION: Record<Market["marketSession"], string> = { open: "Market open", closed: "Market closed", pre: "Pre-market", post: "After hours", halted: "Halted", always: "Trades 24/7" };
const px = (m: Market, v: string | null) => (v == null ? "—" : m.kind === "outcome" ? fmtPct(String(Number(v) * 100), { dp: 1 }) : fmtUsd(v, { dp: Number(v) < 2 ? 4 : 2 }));
type Extra = { positions: OpenPosition[]; strategies: MarketStrategyRef[] };

export default function MarketDetailView({ id }: { id: string }) {
  const [d, setD] = useState<MarketDetailRes | null>(null);
  const [x, setX] = useState<Extra>({ positions: [], strategies: [] });
  const [err, setErr] = useState<Error | null>(null);
  const [live, setLive] = useState<Market | null>(null);

  const [ri, setRi] = useState(0);
  const [hist, setHist] = useState<MarketHistoryRes | null>(null);
  const [histErr, setHistErr] = useState<string | null>(null);
  const visibleHist=hist?.instrumentId===id && hist.range===CHART_RANGES[ri].range?hist:null;
  const warm = warmupMsg(visibleHist?.warmupNotice);
  const [nonce, setNonce] = useState(0);
  useEffect(() => onSession(() => setNonce((n) => n + 1)), []); // inline sign-in refetches
  const [now, setNow] = useState(0);
  useEffect(() => { let on = true; api.marketDetail(id).then((r) => { if (on) { setErr(null); setD(r); setLive(r.market); setNow(Date.now()); } }).catch((e) => on && setErr(e)); return () => { on = false; }; }, [id, nonce]);
  useEffect(() => { // positions + strategies are secondary: failures leave the sections empty
    if (!d) return; let on = true;
    Promise.all([api.positions().catch(() => ({ items: [] as OpenPosition[] })), api.publicStrategies().catch(() => ({ items: [] }))]).then(([pos, pub]) => {
      if (!on) return; const mine = (pos.items as OpenPosition[]).filter((p) => p.instrument === id); const seen = new Set<string>(); const strategies: MarketStrategyRef[] = [];
      for (const p of mine) if (!seen.has(p.strategyId)) { seen.add(p.strategyId); strategies.push({ strategyId: p.strategyId, name: p.strategyName, runId: p.runId, mine: true, status: "running" }); }
      for (const s of publicRefs(pub.items, d.market)) if (!seen.has(s.strategyId)) { seen.add(s.strategyId); strategies.push(s); }
      setX({ positions: mine, strategies });
    });
    return () => { on = false; };
  }, [d, id]);
  const sel = CHART_RANGES[ri];
  useEffect(() => { let on = true; api.marketHistory(id, { tf: sel.tf, range: sel.range }).then((h) => { if (on) { setHist(h); setHistErr(null); } }).catch((e) => { if (on) { setHist(null); setHistErr(e instanceof ApiErr ? errCopy(e.code, e.message) : "Couldn’t load the chart."); } }); return () => { on = false; }; }, [id, sel.tf, sel.range]);

  useEffect(() => {
    if (!d) return; let alive=true;
    const t = setInterval(() => {
      if (document.hidden) return;
      api.markets({ q: d.market.symbol }).then((p) => {
        const m = p.items.find((y) => y.id === id); if (!m || !alive) return;
        setLive(m); setNow(Date.now());
      }).catch(() => {});
    }, 5000);
    return () => {alive=false;clearInterval(t);};
  }, [d, id]);

  if (err) {
    const auth = err instanceof ApiErr && err.status === 401, nf = err instanceof ApiErr && err.status === 404;
    return <Card className="mt-8 p-8 text-center" data-testid="md-error"><h1 className="sr-only">Market</h1><p role="alert" className="text-ink-2">{auth ? "Sign in to see this market." : nf ? "We don’t list that market." : err instanceof ApiErr ? errCopy(err.code, err.message) : "Couldn’t load this market."}</p>
      <div className="mt-4 flex justify-center gap-3">{auth && <SignInButton />}{!nf && <button type="button" onClick={() => setNonce((n) => n + 1)} className="btn rounded-full border border-line-2 px-4 py-1.5 text-[13px] hover:border-white/30">Try again</button>}<Link href="/app/markets" className="btn rounded-full border border-line-2 px-4 py-1.5 text-[13px] hover:border-white/30">All markets</Link></div></Card>;
  }
  if (!d || !live) return <div className="mt-8 space-y-4" role="status" aria-label="Loading market"><h1 className="sr-only">Loading market</h1><div className="h-24 animate-pulse rounded-[14px] bg-card" /><div className="h-[320px] animate-pulse rounded-[14px] bg-card" /></div>;
  const m = live, watch = m.venue === "polymarket";
  const idea = watch ? `When ${m.name} odds rise above 60%, ` : `Buy ${m.symbol} when `;
  return (
    <div data-testid="market-detail">
      <Link href="/app/markets" className="text-[13px] text-muted hover:text-ink">← Markets</Link>
      <header className="mt-4 flex flex-wrap items-end justify-between gap-6" data-motion="rise">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h1 className="font-mono text-[26px] font-semibold tracking-[-.01em]">{m.symbol}</h1><VenueMark venue={m.venue} /><Pill>{KIND[m.kind] ?? m.kind}</Pill>{m.isMock && <Pill tone="warn">Mock price</Pill>}</div>
          <p className="mt-1 truncate text-[14px] text-muted">{m.name}</p>
        </div>
        <div className="text-right" aria-live="polite">
          <div data-testid="md-price" className="q-market-hero">{m.price==null?"—":<QuoteNumber key={m.id} value={m.price} unit={m.kind==="outcome"?"percent":"usd"}/>}</div>
          <div className="mt-2 flex items-center justify-end gap-3 text-[13px]"><span className={`tnum font-mono ${tone(m.change24hPct)}`}>{fmtPct(m.change24hPct, { sign: true, dp: 2 })} 24h</span><span className="text-muted">{fmtSource(m.priceSource, m.priceAt, now)}</span></div>
        </div>
      </header>

      <Card className="mt-6 p-4 sm:p-5" data-testid="md-chart">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Chart range" className="q-chart-switch">{CHART_RANGES.map((r, i) => <button key={r.range} type="button" role="tab" aria-selected={ri === i} onClick={() => setRi(i)} title={`${r.tf} bars`}
            className={`btn rounded-full px-3 py-1 font-mono text-[12.5px] ${ri === i ? "bg-white/[.08] text-ink" : "text-muted hover:text-ink"}`}>{r.label}</button>)}</div>
          <div className="flex items-center gap-2">{!!visibleHist?.bars.length && <span data-testid="md-datasource" className="whitespace-nowrap rounded-[4px] border border-line-2 px-1.5 py-0.5 font-mono text-[11.5px] text-muted">Data: {visibleHist.coverage[0]?.source ?? visibleHist.dataSource}</span>}{warm && <span data-testid="md-warmup" title={warm} className="whitespace-nowrap font-mono text-[11.5px] text-muted">{WARMUP_SHORT}<span className="sr-only">: {warm}</span></span>}{visibleHist?.synthetic && <span data-testid="md-synthetic"><Pill tone="warn">Synthetic</Pill></span>}</div>
        </div>
        {visibleHist && visibleHist.bars.length > 1 ? <HistoryChart key={id+sel.range} points={chartBars(visibleHist)} title={m.symbol+" · "+sel.label} source={visibleHist.coverage[0]?.source ?? "Price history"} unit={m.kind==="outcome"?"percent":"usd"} candles={hasCandles(visibleHist)} step={({"15m":900000,"1h":3600000,"4h":14400000,"1d":86400000})[sel.tf]} /> : histErr ? <p role="alert" className="mt-4 grid h-[220px] place-items-center text-[13.5px] text-muted">{histErr}</p> : visibleHist ? <p className="mt-4 grid h-[220px] place-items-center text-[13.5px] text-muted">No price history for this range yet.</p> : <div className="mt-4 h-[260px] animate-pulse rounded-[10px] bg-white/[.03]" />}
        {visibleHist?.notice && visibleHist.notice !== warm && <p className="mt-2 text-[12px] text-muted" data-testid="md-notice">{visibleHist.notice}</p>}
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-5">
          <Card className="p-5"><h2 className="font-medium">Key stats</h2>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3" data-testid="md-stats">
              {([["1d return", d.returns["1d"]], ["7d return", d.returns["7d"]], ["30d return", d.returns["30d"]]] as [string, string | null][]).map(([k, v]) =>
                <div key={k}><dt className="text-[12px] text-muted">{k}</dt><dd className={`tnum mt-1 font-mono text-[15px] ${tone(v)}`}>{v == null ? "—" : fmtPct(v, { sign: true, dp: 2 })}</dd></div>)}
              {([["30d high", px(m, d.high30d)], ["30d low", px(m, d.low30d)], ["30d volatility", d.volatility30dPct == null ? "—" : fmtPct(d.volatility30dPct, { dp: 2 })]] as [string, string][]).map(([k, v]) =>
                <div key={k}><dt className="text-[12px] text-muted">{k}</dt><dd className="tnum mt-1 font-mono text-[15px]">{v}</dd></div>)}
            </dl>
            {(d.synthetic || d.notice) && <p className="mt-4 text-[12px] text-muted">{d.notice ?? "Stats come from synthetic history."}</p>}
          </Card>
          <Card className="p-5" data-testid="md-positions"><h2 className="font-medium">Your positions</h2>
            {x.positions.length ? <ul className="mt-3 divide-y divide-line">{x.positions.map((p) => (
              <li key={p.runId + p.side} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[13.5px]">
                <div className="min-w-0"><Link href={`/app/run/${p.runId}`} className="font-medium hover:text-ink-2">{p.strategyName}</Link><div className="tnum font-mono text-[12.5px] text-muted">{p.side === "long" ? "Long" : "Short"} {p.qty} @ {px(m, p.avgEntry)}</div></div>
                <span className={`tnum font-mono ${tone(p.unrealizedPnlUsd)}`}>{fmtUsd(p.unrealizedPnlUsd, { sign: true, dp: 2 })}</span></li>))}</ul>
              : <p className="mt-2 text-[13.5px] text-muted">No open positions in {m.symbol}.</p>}
          </Card>
        </div>
        <div className="min-w-0 space-y-5">
          <Card className="p-5" data-testid="md-venue"><h2 className="font-medium">Venue and status</h2>
            <ul className="mt-3 space-y-2.5 text-[13.5px]">
              <li className="flex justify-between gap-3"><span className="text-muted">Venue</span><VenueMark venue={m.venue} /></li>
              <li className="flex justify-between gap-3"><span className="text-muted">Session</span><span>{m.priceStale && m.priceStaleReason === "market_closed" ? "Closed · last close" : SESSION[m.marketSession]}</span></li>
              <li className="flex justify-between gap-3"><span className="text-muted">Status</span><span className="flex items-center gap-1.5"><span aria-hidden className={`size-2 rounded-full ${m.tradable ? "bg-long" : "bg-warn"}`} />{m.tradable ? "Tradable" : watch ? "Watch-only" : "Not tradable now"}</span></li>
              <li className="flex justify-between gap-3"><span className="text-muted">Price source</span><span className="text-right">{fmtSource(m.priceSource, m.priceAt, now)}</span></li>
            </ul>
            {(watch || m.geoRestricted) && <p className="mt-3 text-[12.5px] text-muted">{m.geoRestricted ? "Live trading isn’t available in your region. Paper trading works." : "Watch-only. Odds can trigger trades on other venues."}</p>}
          </Card>
          <Card className="p-5" data-testid="md-strategies"><h2 className="font-medium">Strategies on this market</h2>
            {x.strategies.length ? <ul className="mt-3 space-y-2.5 text-[13.5px]">{x.strategies.map((x) => (
              <li key={x.strategyId} className="flex items-center justify-between gap-3"><Link href={x.runId ? `/app/run/${x.runId}` : "/app/strategies"} className="truncate hover:text-ink-2">{x.name}</Link><span className="shrink-0 text-[12px] text-muted">{x.mine ? "Yours · running" : "Public"}</span></li>))}</ul>
              : <p className="mt-2 text-[13.5px] text-muted">Nothing trades {m.symbol} yet.</p>}
          </Card>
          <Link href={`/app/new?idea=${encodeURIComponent(idea)}`} data-testid="md-build" className="btn flex items-center justify-center rounded-full bg-accent px-5 py-3 text-[14px] font-medium text-bg hover:brightness-110 active:bg-accent-press">Build a strategy for {m.symbol}</Link>
          <p className="text-center text-[12px] text-muted">Opens the builder with an idea filled in. Nothing runs until you say so.</p>
        </div>
      </div>
    </div>
  );
}
