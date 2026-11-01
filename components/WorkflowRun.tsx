"use client";
import { useEffect, useRef, useState } from "react";
import { Play, Pause, ArrowLeft, ExternalLink, Activity } from "lucide-react";
import { PaperQuote, createPaper, freeCash, paperEquity, stepPaper, syntheticFrames, type PaperState } from "@/services/backend/src/workflows/paper";
import { checkpointPaperSession, readPaperSession, type PaperSession } from "@/lib/paper/sessions";
import { strategyEdges, strategyNodes } from "@/lib/api/graph";
import Link from "./Link";
import Wrap from "./Wrap";
import PageHeader from "./PageHeader";
import StrategyGraph from "./StrategyGraph";
import { Spark } from "./ui";
const dollars = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
type QuoteItem = { assetId: string; quote: PaperQuote | null; message: string };
export default function WorkflowRun({ runId }: { runId: string }) {
  const [session, setSession] = useState<PaperSession | null>(null), [loaded, setLoaded] = useState(false), [running, setRunning] = useState(false), [busy, setBusy] = useState(false);
  const [items, setItems] = useState<QuoteItem[]>([]), [error, setError] = useState<string | null>(null);
  const current = useRef<PaperSession | null>(null), release = useRef<(() => void) | null>(null), generation = useRef(0), alive = useRef(false), inFlight = useRef(false), acquiring = useRef(false);
  const save = (state: PaperState | null, status: PaperSession["status"]) => { const s = checkpointPaperSession(runId, state, status); current.current = s; if (alive.current) setSession(s); return s; };
  const pause = () => {
    generation.current++; release.current?.(); release.current = null;
    if (alive.current) { setRunning(false); setBusy(false); }
    if (current.current?.status === "running") { try { save(current.current.state, "paused"); } catch (e) { if (alive.current) setError((e as Error).message); } }
  };
  const refresh = async (execute = false) => {
    const s = current.current; if (!s || inFlight.current) return; inFlight.current = true; setBusy(true); const gen = generation.current;
    try {
      const r = await fetch("/api/preview/quotes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(s.strategy.workflow!.assets) });
      const data = await r.json() as { message?: string; items: QuoteItem[] }; if (!r.ok) throw new Error(data.message ?? "Market data is unavailable. Try again shortly.");
      if (!alive.current || gen !== generation.current) return;
      const next = data.items.map((x) => ({ ...x, quote: x.quote ? PaperQuote.parse(x.quote) : null })); setItems(next); setError(null);
      if (execute && current.current?.state) save(stepPaper(s.strategy.workflow!, current.current.state, next.flatMap((x) => x.quote ? [x.quote] : []), Date.now(), s.strategy.risk), "running");
    } catch (e) { if (alive.current && gen === generation.current) { setError(e instanceof Error ? e.message : "Market data unavailable."); if (execute) pause(); } }
    finally { inFlight.current = false; if (alive.current && gen === generation.current) setBusy(false); }
  };
  const start = async () => {
    if (acquiring.current || release.current) return;
    const existing = readPaperSession(runId);
    if (existing?.mode === "scenario") {
      try {
        if (existing.status === "completed") { current.current = existing; setSession(existing); return; }
        const frames = syntheticFrames(existing.strategy.workflow!); let state = createPaper(existing.strategy.workflow!, frames[0].at);
        for (const f of frames) state = stepPaper(existing.strategy.workflow!, state, f.quotes, f.at, existing.strategy.risk);
        save(state, "completed"); setError(null);
      } catch (e) { setError((e as Error).message); }
      return;
    }
    if (!navigator.locks) { setError("This browser cannot safely run a paper session. Open it in a current desktop browser."); return; }
    acquiring.current = true; const gen = generation.current; setError(null);
    try { await navigator.locks.request(`quiver-paper-${runId}`, { ifAvailable: true }, async (lock) => {
      if (!alive.current || gen !== generation.current) return;
      if (!lock) { setError("This session is already open in another tab. Pause it there before continuing here."); return; }
      const s = readPaperSession(runId); if (!s) throw new Error("Paper session not found."); current.current = s;
      if (s.mode === "scenario") {
        if (s.status === "completed") { setSession(s); return; }
        const frames = syntheticFrames(s.strategy.workflow!); let state = createPaper(s.strategy.workflow!, frames[0].at);
        for (const f of frames) state = stepPaper(s.strategy.workflow!, state, f.quotes, f.at, s.strategy.risk);
        save(state, "completed"); return;
      }
      const done = new Promise<void>((resolve) => { release.current = resolve; });
      try { save(s.state ?? createPaper(s.strategy.workflow!), "running"); setRunning(true); await done; }
      finally { release.current = null; }
    }); } catch (e) { if (alive.current) { setError((e as Error).message); pause(); } }
    finally { acquiring.current = false; }
  };
  useEffect(() => {
    alive.current = true; const s = readPaperSession(runId); current.current = s; setSession(s); setLoaded(true);
    // Only a newly created session starts automatically. Reloading an existing session restores it paused.
    const gen = generation.current;
    if (s?.status === "ready") queueMicrotask(() => { if (alive.current && gen === generation.current) void start(); });
    const leave = () => pause(); window.addEventListener("pagehide", leave);
    return () => { pause(); alive.current = false; window.removeEventListener("pagehide", leave); };
  }, [runId]);
  useEffect(() => { if (!running) return; void refresh(true); const timer = setInterval(() => void refresh(true), 20_000); return () => clearInterval(timer); }, [running]);
  if (!loaded) return <Wrap><PageHeader title="Opening paper session…" sub="Loading your saved strategy and checkpoint." /><div className="mt-8 h-64 animate-pulse rounded-[14px] border border-line bg-card" /></Wrap>;
  if (!session) return <Wrap><PageHeader title="Paper session unavailable" sub="This session is saved in the browser where you created it. Open it there, or start a new test from your strategy." /><Link href="/app/run" className="q-action mt-6">Back to paper trades</Link></Wrap>;
  const w = session.strategy.workflow!, state = session.state, scenario = session.mode === "scenario";
  const stageName = (id: string) => { const s = w.stages.find((s) => s.id === id); return s ? `${s.side} ${w.assets.find((a) => a.id === s.assetId)?.query ?? "asset"}` : id; };
  const status = running ? "Running" : scenario && state ? "Completed" : "Paused";
  return <Wrap>
    <Link href="/app/run" className="mb-5 inline-flex min-h-10 items-center gap-2 text-[13px] text-muted hover:text-ink"><ArrowLeft size={14} />Paper trades</Link>
    <PageHeader title={session.name} sub={`${scenario ? "Synthetic scenario" : "Live quote paper session"} · Strategy v${session.strategyVersion} · ${new Date(session.createdAt).toLocaleString()}`} right={<span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] ${running ? "border-accent/30 text-accent" : "border-line-2 text-muted"}`}><span className={`h-1.5 w-1.5 rounded-full ${running ? "bg-accent" : "bg-muted"}`} />{status}</span>} />
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-y border-line py-4">
      <p className="max-w-[58ch] text-[12.5px] leading-relaxed text-muted">{scenario ? "Invented prices test your rules. These results are not historical performance." : "Virtual trades use indicative prices. Leaving or closing this page pauses observation; resume here to continue."}</p>
      <div className="flex flex-wrap gap-2">{!scenario && <><button onClick={() => void refresh()} disabled={busy || running} className="q-action">{busy ? "Reading markets…" : "Refresh quotes"}</button><button onClick={running ? pause : () => void start()} className={`q-action ${running ? "" : "q-primary"}`}>{running ? <Pause size={14} /> : <Play size={14} />}{running ? "Pause session" : "Resume session"}</button></>}{scenario && !state && <button onClick={() => void start()} className="q-action q-primary">Run scenario</button>}<Link href={`/app/new?strategy=${encodeURIComponent(session.strategyId)}`} className="q-action"><ExternalLink size={14} />Open strategy</Link></div>
    </div>
    {error && <p role="alert" className="mt-4 rounded-xl border border-short/30 bg-short/5 p-4 text-[13px] text-short">{error}</p>}
    <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-line bg-line lg:grid-cols-4">{[["Equity", state ? paperEquity(state) : w.budgetUsd!], ["Available cash", state ? freeCash(state) : w.budgetUsd!], ["Realized P&L", state?.realized ?? 0], ["Modeled fees", state?.fees ?? 0]].map(([label, amount]) => <div key={label} className="bg-card p-5"><p className="text-[12px] text-muted">{label}</p><p className="mt-2 font-mono text-[22px] tracking-[-.02em]">{dollars(Number(amount))}</p></div>)}</div>
    {state && state.curve.length > 1 && <div className="mt-6 rounded-[14px] border border-line bg-card p-5"><div className="mb-5 flex items-center justify-between text-[13px]"><h2>Equity over this session</h2><span className="text-[12px] text-muted">{scenario ? "Synthetic prices" : "Observed quotes"}</span></div><Spark fluid h={100} pts={state.curve.map(([, v]) => v)} tone={paperEquity(state) < state.budget ? "short" : "long"} /></div>}
    <section className="mt-6 rounded-[14px] border border-line bg-card p-5 sm:p-6"><h2 className="mb-5 text-[15px] font-medium">Workflow</h2><StrategyGraph nodes={strategyNodes(session.strategy)} edges={strategyEdges(session.strategy)} /></section>
    <section className="mt-6 rounded-[14px] border border-line bg-card"><h2 className="border-b border-line px-5 py-4 text-[15px] font-medium">Execution</h2><div className="divide-y divide-line">{w.stages.map((s, i) => <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-[13px]"><span className="flex items-center gap-3"><span className="font-mono text-[11px] text-muted">{i + 1}</span><span className="capitalize">{stageName(s.id)}</span></span><span className="text-muted">{state?.stages[s.id]?.fills ?? 0} fills · {state?.stages[s.id]?.status ?? "Waiting to start"}</span></div>)}</div></section>
    <section className="mt-6 overflow-hidden rounded-[14px] border border-line bg-card"><div className="flex items-center justify-between border-b border-line px-5 py-4"><h2 className="text-[15px] font-medium">Trade log</h2><span className="text-[12px] text-muted">{state?.events.length ?? 0} fills</span></div>{state?.events.length ? <div className="max-h-96 overflow-auto"><table className="w-full text-left text-[12.5px]"><thead className="bg-bg text-[12px] text-muted"><tr>{["Time", "Action", "Value", "Details"].map((t) => <th key={t} className="px-5 py-3 font-normal">{t}</th>)}</tr></thead><tbody>{state.events.map((e, i) => <tr key={i} className="border-t border-line"><td className="whitespace-nowrap px-5 py-4 text-muted">{new Date(e.at).toLocaleTimeString()}</td><td className="whitespace-nowrap px-5 py-4 capitalize">{e.kind} · {stageName(e.stageId)}</td><td className="px-5 py-4 font-mono">{dollars(e.amount)}</td><td className="min-w-56 px-5 py-4 text-muted">{e.detail} · price {e.price.toLocaleString("en-US", { maximumFractionDigits: 10 })}</td></tr>)}</tbody></table></div> : <div className="flex items-start gap-3 p-6 text-muted"><Activity size={18} className="mt-0.5 shrink-0" /><div><p className="text-[14px] text-ink-2">Waiting for the first fill</p><p className="mt-1 text-[12.5px]">Orders appear here when their conditions and risk limits allow a trade.</p></div></div>}</section>
    {items.length > 0 && <section className="mt-6 rounded-[14px] border border-line p-5"><h2 className="text-[15px] font-medium">Market observations</h2><div className="mt-3 divide-y divide-line">{items.map((x) => <div key={x.assetId} className="py-3 text-[12px]"><p className="text-[13px] text-ink-2">{w.assets.find((a) => a.id === x.assetId)?.query} {x.quote ? `· $${x.quote.price.toLocaleString("en-US", { maximumFractionDigits: 10 })}` : "· unavailable"}</p><p className="mt-1 text-muted">{x.message} {x.quote ? `· ${x.quote.source} · ${new Date(x.quote.observedAt).toLocaleString()}` : ""}</p></div>)}</div></section>}
    <details className="mt-6 text-[12px] leading-relaxed text-muted"><summary className="min-h-11 py-3">Session assumptions & risk limits</summary><p>Modeled fee: 0.1% per fill. Gas, order-book slippage and perpetual funding costs are not modeled. Cross-venue balances are virtual. Max position {session.strategy.risk.maxPositionPct}% of equity; total exposure {session.strategy.risk.maxTotalExposurePct}%. This session keeps the strategy version it started with. Checkpoints are saved in this browser; missing time is never replayed.</p></details>
  </Wrap>;
}
