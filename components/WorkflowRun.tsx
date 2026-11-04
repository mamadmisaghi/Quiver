"use client";
import "./PaperSession.css";
import { useEffect, useRef, useState } from "react";
import LegacyPaperRun from "./LegacyPaperRun";
import { Play, Pause, ArrowLeft, ExternalLink } from "lucide-react";
import { PaperQuote, createPaper, freeCash, paperEquity, stepPaper, type PaperState, type PaperStepEvent } from "@/services/backend/src/workflows/paper";
import { activeSessionMs, checkpointPaperSession, readPaperSession, savePaperEdit, type PaperSession } from "@/lib/paper/sessions";
import { strategyEdges, strategyNodes } from "@/lib/api/graph";
import Link from "./Link";
import Wrap from "./Wrap";
import PageHeader from "./PageHeader";
import StrategyGraph from "./StrategyGraph";
import { paperGraphPulses, type EdgePulse } from "@/lib/paper/graph-events";
import { tickActivity, type ActivityNote, type MarketObservation } from "@/lib/paper/observations";
import { preparePaperEdit, type EditOps } from "@/lib/paper/changes";
import { RunActivity, RunPositions, RunSignals, RunTriggers } from "./PaperSessionPanels";
import PaperChangePanel from "./PaperChangePanel";
import { Spark } from "./ui";
const dollars = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
type QuoteItem = MarketObservation;
function SessionClock({ session, running }: { session: PaperSession; running: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    tick(); const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const measured = session.activeMs !== undefined;
  const seconds = Math.floor(activeSessionMs(session, now, running) / 1000);
  const time = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(x => String(x).padStart(2, "0")).join(":");
  return <span className="q-session-clock" role="timer" aria-label="Active session time" title={measured ? "Recorded active time. Paused intervals are excluded." : "Active time will be recorded from the next resume."}>{measured ? time : "—"}</span>;
}
export default function WorkflowRun({ runId }: { runId: string }) {
  // RunView mounts this client-only component with a fresh key for each session.
  const [session, setSession] = useState<PaperSession | null>(() => typeof window === "undefined" ? null : readPaperSession(runId));
  const [running, setRunning] = useState(false), [busy, setBusy] = useState(false);
  const [items, setItems] = useState<QuoteItem[]>([]), [error, setError] = useState<string | null>(null);
  const [pulses, setPulses] = useState<EdgePulse[]>([]);
  const current = useRef<PaperSession | null>(session), release = useRef<(() => void) | null>(null), generation = useRef(0), alive = useRef(false), inFlight = useRef<AbortController | null>(null), acquiring = useRef(false);
  const save = (state: PaperState | null, status: PaperSession["status"], resume = false, notes: ActivityNote[] = []) => { const s = checkpointPaperSession(runId, state, status, localStorage, resume, true, notes, current.current?.editRevision ?? 0); current.current = s; if (alive.current) setSession(s); return s; };
  const pause = (notes: ActivityNote[] = []) => {
    const ownsSession = release.current !== null;
    generation.current++; inFlight.current?.abort(); inFlight.current = null;
    if (alive.current) { setPulses([]); setRunning(false); setBusy(false); }
    // A second tab can observe this session, but must never overwrite its driver's checkpoint.
    if (ownsSession && current.current?.status === "running") { try { save(current.current.state, "paused", false, notes); } catch (e) { if (alive.current) setError((e as Error).message); } }
    release.current?.(); release.current = null;
  };
  const refresh = async (execute = false) => {
    const s = current.current; if (!s || inFlight.current || execute && !release.current) return;
    const controller = new AbortController(); inFlight.current = controller;
    setBusy(true); const gen = generation.current;
    try {
      const r = await fetch("/api/preview/quotes", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify(s.strategy.workflow!.assets) });
      const data = await r.json() as { message?: string; items: QuoteItem[] }; if (!r.ok) throw new Error(data.message ?? "Market data is unavailable. Try again shortly.");
      if (!alive.current || gen !== generation.current) return;
      const next = data.items.map((x) => ({ ...x, quote: x.quote && !x.quote.synthetic ? PaperQuote.parse(x.quote) : null })); setItems(next); setError(null);
      if (execute && current.current?.state) {
        const workflow = s.strategy.workflow!, trace: PaperStepEvent[] = [];
        const now = Date.now(), prior = current.current.state;
        const state = stepPaper(workflow, prior, next.flatMap(x => x.quote ? [x.quote] : []), now, s.strategy.risk, trace, s.pausedRules);
        const persisted = save(state, "running", false, tickActivity(workflow, prior, state, next, trace));
        setPulses(persisted.status === "running" && !document.hidden ? paperGraphPulses(workflow, trace, state.lastAt) : []);
      }
    } catch (e) { if (alive.current && gen === generation.current) { const detail = e instanceof Error ? e.message : "Market data unavailable."; setError(detail); if (execute) pause([{ at: Date.now(), kind: "issue", label: "Observation failed", detail }]); } }
    finally { if (inFlight.current === controller) inFlight.current = null; if (alive.current && gen === generation.current) setBusy(false); }
  };
  async function applyChange(ops: EditOps, base: number) {
    const commit = (driver: boolean) => {
      const updated = savePaperEdit(runId, base, s => preparePaperEdit(s, ops), driver);
      // A response requested under the previous rules must never execute against the new revision.
      generation.current++; inFlight.current?.abort(); inFlight.current = null;
      current.current = updated; setSession(updated); setBusy(false); setPulses([]);
      if (driver) void refresh(true);
    };
    if (release.current) { commit(true); return; }
    if (!navigator.locks) throw Error("Open this session in a browser that supports single-tab execution.");
    await navigator.locks.request("quiver-paper-" + runId, { ifAvailable: true }, lock => {
      if (!lock) throw Error("This session is running in another tab. Apply the change there, or pause it first.");
      commit(false);
    });
  }
  useEffect(() => {
    if (!pulses.length) return;
    const timer = setTimeout(() => setPulses([]), Math.max(...pulses.map(p => p.delay ?? 0)) + 360);
    return () => clearTimeout(timer);
  }, [pulses]);
  const start = async () => {
    if (acquiring.current || release.current) return;
    const existing = readPaperSession(runId);
    if (existing?.mode !== "quotes") return;
    if (!navigator.locks) { setError("This browser cannot safely run a paper session. Open it in a current desktop browser."); return; }
    acquiring.current = true; const gen = generation.current; setError(null);
    try { await navigator.locks.request(`quiver-paper-${runId}`, { ifAvailable: true }, async (lock) => {
      if (!alive.current || gen !== generation.current) return;
      if (!lock) { setError("This session is already open in another tab. Pause it there before continuing here."); return; }
      const s = readPaperSession(runId); if (!s) throw new Error("Paper session not found."); current.current = s;
      const done = new Promise<void>((resolve) => { release.current = resolve; });
      try { save(s.state ?? createPaper(s.strategy.workflow!), "running", true); setRunning(true); await done; }
      finally { release.current = null; }
    }); } catch (e) { if (alive.current) { setError((e as Error).message); pause(); } }
    finally { acquiring.current = false; }
  };
  useEffect(() => {
    alive.current = true; const s = current.current;
    // Only a newly created session starts automatically. Reloading an existing session restores it paused.
    const gen = generation.current;
    if (s?.strategy.workflow && s.mode === "quotes" && s.status === "ready") queueMicrotask(() => { if (alive.current && gen === generation.current) void start(); });
    function externalChange(event: StorageEvent) {
      if (event.key !== "quiver.paper-session.v1." + runId) return;
      const latest = readPaperSession(runId);
      if (!latest) return;
      if (latest.status === "paused" && release.current) {
        current.current = latest;
        pause();
      }
      current.current = latest; setSession(latest);
    }
    window.addEventListener("storage", externalChange);
    const leave = () => pause(); window.addEventListener("pagehide", leave);
    return () => { pause(); alive.current = false; window.removeEventListener("pagehide", leave); window.removeEventListener("storage", externalChange); };
  }, [runId]);
  useEffect(() => { if (!running) return; void refresh(true); const timer = setInterval(() => void refresh(true), 20_000); return () => clearInterval(timer); }, [running]);
  if (!session) return <Wrap><PageHeader title="Paper session unavailable" sub="This session is saved in the browser where you created it. Open it there, or start a new session from your strategy." /><Link href="/app/run" className="q-action mt-6">Back to paper trades</Link></Wrap>;
  if (!session.strategy.workflow) return <LegacyPaperRun session={session} />;
  return <WorkflowScreen session={session} running={running} busy={busy} items={items} pulses={pulses} error={error}
    start={() => void start()} pause={() => pause()} refresh={() => void refresh()} applyChange={applyChange} />;
}
export function WorkflowScreen({session,running,busy,items,pulses,error,start,pause,refresh,stop,applyChange,server=false,extra}:{
  session:PaperSession; running:boolean; busy:boolean; items:MarketObservation[]; pulses:EdgePulse[]; error:string|null;
  start:()=>void; pause:()=>void; refresh?:()=>void; stop?:()=>void; applyChange:(ops:EditOps,base:number)=>Promise<void>; server?:boolean; extra?:React.ReactNode;
}) {
  const w = session.strategy.workflow!, state = session.state, scenario = session.mode === "scenario";
  const archived = session.provenance === "imported";
  const stopped = session.status === "completed";
  const status = archived || scenario ? "Archived" : stopped ? "Stopped" : running ? "Running" : "Paused";
  const nodes = strategyNodes(session.strategy);
  const lastCheck = state && state.lastAt >= state.startedAt ? new Date(state.lastAt).toLocaleTimeString() : null;
  return <Wrap>
    <Link href="/app/run" className="mb-5 inline-flex min-h-10 items-center gap-2 text-[13px] text-muted hover:text-ink"><ArrowLeft size={14} />Paper trades</Link>
    <PageHeader title={session.name} sub={`${archived ? "Imported browser history" : scenario ? "Archived simulation" : server ? "Server paper session" : "Live quote paper session"} · Strategy v${session.strategyVersion}${session.editRevision ? " · Session edit " + session.editRevision : ""} · ${new Date(session.createdAt).toLocaleString()}`} right={<span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] ${running ? "border-accent/30 text-accent" : "border-line-2 text-muted"}`}><span className={`h-1.5 w-1.5 rounded-full ${running ? "bg-accent" : "bg-muted"}`} />{status}{!scenario && <SessionClock session={session} running={running} />}</span>} />
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-y border-line py-4">
      <p className="max-w-[58ch] text-[12.5px] leading-relaxed text-muted">{archived ? "Imported history is read-only. Start a fresh session from a saved strategy to observe markets." : server ? "Quiver observes these markets on the server, including when you close this page. Trades use virtual funds." : scenario ? "This archived session used generated prices. Open the strategy to start a new paper session with live market prices." : "Virtual trades use indicative prices. Leaving or closing this page pauses observation; resume here to continue."}</p>
      <div className="flex flex-wrap gap-2">{!scenario && !stopped && <>{refresh && <button onClick={refresh} disabled={busy || running} className="q-action">{busy ? "Reading markets…" : "Refresh quotes"}</button>}{stop && <button onClick={stop} disabled={busy} className="q-action">Stop session</button>}<button disabled={server && busy} onClick={running ? pause : start} className={`q-action ${running ? "" : "q-primary"}`}>{running ? <Pause size={14} /> : <Play size={14} />}{running ? "Pause session" : "Resume session"}</button></>}{!scenario && !archived && <Link href={"/app/live?strategy="+encodeURIComponent(session.strategyId)} className="q-action">Live trade</Link>}<Link href={archived ? "/app/strategies" : `/app/new?strategy=${encodeURIComponent(session.strategyId)}`} className="q-action"><ExternalLink size={14} />{archived ? "Saved strategies" : "Open strategy"}</Link></div>
    </div>
    {error && <p role="alert" className="mt-4 rounded-xl border border-short/30 bg-short/5 p-4 text-[13px] text-short">{error}</p>}
    <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-line bg-line lg:grid-cols-4">{[["Equity", state ? paperEquity(state) : w.budgetUsd!], ["Available cash", state ? freeCash(state) : w.budgetUsd!], ["Realized P&L", state?.realized ?? 0], ["Modeled fees", state?.fees ?? 0]].map(([label, amount]) => <div key={label} className="bg-card p-5"><p className="text-[12px] text-muted">{label}</p><p className="mt-2 font-mono text-[22px] tracking-[-.02em]">{dollars(Number(amount))}</p></div>)}</div>
    {state && state.curve.length > 1 && <div className="mt-6 rounded-[14px] border border-line bg-card p-5"><div className="mb-5 flex items-center justify-between text-[13px]"><h2>Equity over this session</h2><span className="text-[12px] text-muted">{scenario ? "Synthetic prices" : "Observed quotes"}</span></div><Spark fluid h={100} pts={state.curve.map(([, v]) => v)} tone={paperEquity(state) < state.budget ? "short" : "long"} /></div>}
    <section className="mt-6 rounded-[14px] border border-line bg-card p-5 sm:p-6"><div className="q-observation-head"><h2 className="text-[15px] font-medium">Workflow</h2>{!scenario && <span>{running ? (busy ? "Reading market quotes" : "Watching markets") : "Observation paused"}{lastCheck ? " · Last check " + lastCheck : ""}</span>}</div><StrategyGraph nodes={nodes} edges={strategyEdges(session.strategy)} pulses={running && !scenario && session.status === "running" ? pulses : []} /></section>
    <div className="q-run-columns"><RunSignals session={session} items={items} /><RunActivity session={session} running={running} /></div>
    <RunTriggers session={session} />
    {extra}
    {!scenario && !stopped && <PaperChangePanel session={session} onApply={applyChange} />}
    <RunPositions session={session} />
    <details className="mt-6 text-[12px] leading-relaxed text-muted"><summary className="min-h-11 py-3">Session assumptions & risk limits</summary><p>Modeled fee: 0.1% per fill. Gas, order-book slippage and perpetual funding costs are not modeled. Cross-venue balances are virtual. Max position {session.strategy.risk.maxPositionPct}% of equity; total exposure {session.strategy.risk.maxTotalExposurePct}%. Session edits apply from the next observation. {server ? "Checkpoints, fills and edits are recorded on your account." : "Fills and balances are recorded in this browser."}</p></details>
  </Wrap>;
}
