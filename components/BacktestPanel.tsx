"use client";
// Backtest stats + costs (backend M3, api-contracts §13). Coverage labels via fmtSource: Chainlink / Modeled / —.
import { useEffect, useState } from "react";
import { API_MODE, api, ApiErr, reasonOf, checkEquity, errOf, rangeGuidance, fmtNum, fmtPct, fmtUsd, fmtSource, warmupMsg, WARMUP_SHORT, tone, type BacktestRes, type Strategy } from "@/lib/api";
import { Card, Spark } from "./ui";

const cap = (x: string) => x.replace(/^./, (c) => c.toUpperCase());
/** Human label for a coverage row: market symbol/name when known, otherwise a venue-level label. Never a raw instrument id. */
const instLabel = (id: string, names: Record<string, string>) => {
  if (names[id]) return names[id];
  const [v, , ...r] = id.split(":");
  if (v === "robinhood") return "Stock token · Robinhood Chain";
  if (v === "hl") return `${r.join(" ")} perp · Hyperliquid`;
  if (v === "pm") return `${cap((r[0] ?? "").replace(/-/g, " "))}${r[1] ? ` · ${r[1]}` : ""} · Polymarket`;
  if (v === "sol") return "Solana token";
  return "Market";
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** M3.6: default backtest end = now − 2 min, so a slightly fast client clock never asks for the future. */
const defaultEnd = () => new Date(Date.now() - 2 * 60_000);

export default function BacktestPanel({ strategy, days = 30 }: { strategy: Strategy; days?: number }) {
  const [bt, setBt] = useState<BacktestRes | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => { let on = true; api.markets().then((p) => on && setNames(Object.fromEntries(p.items.map((m) => [m.id, `${m.symbol} · ${m.name}`])))).catch(() => {}); return () => { on = false; }; }, []);
  const [equity, setEquity] = useState("10000");
  const [range, setRange] = useState<{ from?: string; to?: string }>({}); // overrides after a clamp
  const [clamp, setClamp] = useState<{ from?: string; to?: string } | null>(null);
  const eqErr = checkEquity(equity);
  const run = async (over: { from?: string; to?: string } = range) => {
    if (eqErr) return; // M3.5: 100 … 10,000,000, validated before we call the API
    setBusy(true); setErr(null); setHint(null); setClamp(null);
    try {
      const now = defaultEnd(), to = over.to ? new Date(over.to) : now, from = over.from ? new Date(over.from) : new Date(to.getTime() - days * 86_400_000);
      let r = await api.backtest({ strategy, from: from.toISOString(), to: to.toISOString(), resolution: "1h", startingEquityUsd: equity.replace(/[,\s$]/g, "") });
      for (let i = 0; i < 120 && (r.status === "queued" || r.status === "running"); i++) { setBt(r); await sleep(1000); r = await api.backtestStatus(r.id); }
      // M3.5: internal failures arrive sanitized ("Backtest failed. Try again or change the range."); show it as-is.
      setBt(r); if (r.status === "failed") setErr(r.error?.trim() || "The backtest couldn't finish. Try again or change the range.");
    } catch (x) {
      if (x instanceof ApiErr && x.code === "backtest_range_invalid") {
        const g = rangeGuidance(x.details);
        // M3.6: reason "future" → clamp to the server's latestTo and rerun once (no loop if it still refuses).
        if (reasonOf(x) === "future" && g.clampTo?.to && over.to !== g.clampTo.to) { const next = { ...over, to: g.clampTo.to }; setRange(next); setBusy(false); void run(next); setHint(`${g.text} Clamped the end to that.`); return; }
        setHint(g.text); setClamp(g.clampTo ?? null);
      }
      // M3.4: a window shorter than one bar at the chosen resolution is rejected as validation_failed
      else if (x instanceof ApiErr && x.code === "validation_failed" && /equity/i.test(x.message + JSON.stringify(x.details ?? ""))) setHint("Starting balance must be between $100 and $10,000,000.");
      else if (x instanceof ApiErr && x.code === "validation_failed") setHint("That window is too short to test. Pick a range that covers at least one full 1-hour bar, then run again.");
      else setErr(errOf(x, "Couldn't start the backtest."));
    }
    setBusy(false);
  };
  const applyClamp = () => { if (!clamp) return; const next = { ...range, ...clamp }; setRange(next); void run(next); };
  const res = bt?.status === "done" ? bt.result : null;
  const warm = res ? warmupMsg(bt!.warmupNotice) : null;
  const st = res?.stats, co = res?.costs;
  const stat = (k: string, v: string, c = "") => (
    <div key={k} className="bg-bg-2 px-4 py-3"><div className="text-[12px] text-muted">{k}</div><div className={`tnum mt-1 font-mono text-[15px] ${c}`}>{v}</div></div>);
  const hrs = (h?: string) => (h == null ? "—" : Number(h) >= 48 ? `${fmtNum(String(Number(h) / 24), 1)} days` : `${fmtNum(h, 1)} h`);
  return (
    <Card className="bg-bg-2 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><div className="text-[14px] font-medium">{API_MODE === "mock" ? "Rule simulation" : "Backtest"} · last {days} days</div><p className="mt-0.5 text-[12.5px] text-muted">{API_MODE === "mock" ? "Tests your actual rules on synthetic prices, including fees and slippage. Historical market performance needs a real data connection." : "Simulated on historical prices with fees, gas, spread and impact."}</p></div>
        <div className="flex flex-wrap items-start gap-2">
        <label className="flex flex-col text-[12px] text-muted">
          <span className="sr-only sm:not-sr-only">Starting balance (USD)</span>
          <input inputMode="decimal" value={equity} onChange={(e) => setEquity(e.target.value)} aria-label="Starting balance in USD" aria-invalid={!!eqErr} aria-describedby={eqErr ? "bt-eq-err" : undefined} className="tnum mt-0.5 w-[120px] rounded-full border border-line-2 bg-transparent px-3 py-1.5 font-mono text-[13px] text-ink aria-[invalid=true]:border-short/60" />
          {eqErr && <span id="bt-eq-err" className="mt-1 max-w-[220px] text-[12px] text-short">{eqErr}</span>}
        </label>
        <button onClick={() => run()} disabled={busy || !!eqErr} className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] text-ink-2 hover:border-white/30 hover:bg-white/5 disabled:opacity-60">{busy ? (bt ? `Running · ${Math.round(bt.progress * 100)}%` : "Starting…") : res ? "Run again" : API_MODE === "mock" ? "Test these rules" : "Run backtest"}</button>
        </div>
      </div>
      {err && <p role="alert" className="mt-4 text-[13.5px] text-short">{err}</p>}
      {hint && <div role="status" className="mt-4 flex flex-wrap items-center gap-3 rounded-[10px] border border-line px-3 py-2 text-[13px] text-ink-2"><span>{hint}</span>{clamp && <button type="button" onClick={applyClamp} disabled={busy} className="btn rounded-full border border-line-2 px-3 py-1 text-[12.5px] hover:border-white/30">Use the allowed range</button>}</div>}
      {res && (<>
        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_260px]">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-line bg-line sm:grid-cols-4">
            {stat("Return", fmtPct(res.returnPct, { sign: true }), tone(res.returnPct))}
            {stat("Max drawdown", fmtPct(res.maxDrawdownPct), "")}
            {stat("Drawdown length", hrs(st?.maxDrawdownDurationHours))}
            {stat("Volatility (ann.)", st?.volatilityAnnPct != null ? fmtPct(st.volatilityAnnPct) : "—")}
            {stat("Sharpe", res.sharpe != null ? fmtNum(res.sharpe) : "—")}
            {stat("Sortino", st?.sortino != null ? fmtNum(st.sortino) : "—")}
            {stat("Profit factor", st?.profitFactor != null ? fmtNum(st.profitFactor) : "—")}
            {stat("Closed trades", st ? String(st.closedTrades) : String(res.trades))}
            {stat("Win rate", res.winRatePct != null ? fmtPct(res.winRatePct) : "—")}
            {stat("Avg win", fmtUsd(st?.avgWinUsd), tone(st?.avgWinUsd))}
            {stat("Avg loss", fmtUsd(st?.avgLossUsd), tone(st?.avgLossUsd))}
            {stat("Ending equity", fmtUsd(res.endingEquityUsd))}
          </div>
          <div className="rounded-[12px] border border-line p-4">
            <div className="text-[12.5px] text-muted">Costs</div>
            {co ? (
              <dl className="mt-3 space-y-2 text-[13.5px]">
                {([["Fees", co.feesUsd], ["Gas", co.gasUsd], ["Spread", co.spreadUsd], ["Price impact", co.impactUsd]] as const).map(([k, v]) => (
                  <div key={k} className="flex justify-between"><dt className="text-ink-2">{k}</dt><dd className="tnum font-mono">{fmtUsd(v)}</dd></div>))}
                <div className="flex justify-between border-t border-line pt-2"><dt className="text-ink-2">Total</dt><dd className="tnum font-mono">{fmtUsd((Number(co.feesUsd) + Number(co.gasUsd) + Number(co.spreadUsd) + Number(co.impactUsd)).toFixed(2))}</dd></div>
              </dl>) : <p className="mt-3 text-[13px] text-muted">Fees {fmtUsd(res.feesUsd)}</p>}
            {res.equityCurve.length > 1 && <div className="mt-4"><Spark fluid tone={Number(res.returnPct) < 0 ? "short" : "long"} pts={res.equityCurve.map(([, v]) => Number(v))} /></div>}
          </div>
        </div>
        <div className="mt-5">
          <div className="flex items-center justify-between gap-3 text-[12.5px] text-muted"><span>Data used</span><span className="flex flex-wrap items-center justify-end gap-2"><span data-testid="bt-datasource" className="whitespace-nowrap rounded-[4px] border border-line-2 px-1.5 py-0.5 font-mono text-[11.5px] text-muted">Data: {API_MODE === "mock" ? "Synthetic" : bt!.dataSource === "tiingo" ? "Tiingo" : "fallback"}</span>{warm && <span data-testid="bt-warmup" title={warm} className="whitespace-nowrap font-mono text-[11.5px] text-muted">{WARMUP_SHORT}<span className="sr-only">: {warm}</span></span>}</span></div>
          <ul className="mt-2 divide-y divide-line rounded-[12px] border border-line text-[13px]">
            {bt!.dataCoverage.map((c, i) => (
              <li key={i} className="grid grid-cols-[1fr_7rem_auto] gap-3 px-4 py-2.5">
                <span className="text-ink-2">{instLabel(c.instrument, names)}</span>
                <span className={c.source === "none" ? "text-muted" : ""}>{fmtSource(c.source)}{c.source === "none" && <span className="sr-only">No data</span>}</span>
                <span className="tnum font-mono text-[12px] text-muted">{new Date(c.from).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}–{new Date(c.to).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}{c.gaps ? ` · ${c.gaps} gaps` : ""}</span>
              </li>))}
          </ul>
          {(() => { // M3.4: "No price data…" / "No trades…" caveats become their own quiet notes
            const note = (c: string) => /^No (price data|trades)\b/.test(c), notes = res.caveats.filter(note), rest = res.caveats.filter((c) => !note(c) && c !== warm);
            return <>
              {notes.length > 0 && <ul className="mt-3 space-y-1.5">{notes.map((c) => <li key={c} className="flex items-start gap-2 text-[12.5px] text-muted"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-muted" aria-hidden /><span><span className="sr-only">Note: </span>{c}</span></li>)}</ul>}
              <p className="mt-3 text-[12px] text-muted">{rest.join(" ")}{st?.conventions ? ` ${st.conventions}` : ""}</p>
            </>; })()}
        </div>
      </>)}
    </Card>
  );
}
