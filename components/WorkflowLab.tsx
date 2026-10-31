"use client";
import { useEffect, useRef, useState } from "react";
import type { Strategy } from "@/lib/contracts";
import { PaperQuote, createPaper, freeCash, paperEquity, paperProblems, stepPaper, syntheticFrames, type PaperState } from "@/services/backend/src/workflows/paper";
import { Spark } from "./ui";
const dollars = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const checkpointKey = "quiver.workflow-paper.v1";
type QuoteItem = { assetId: string; quote: PaperQuote | null; message: string };
export default function WorkflowLab({ strategy }: { strategy: Strategy }) {
  const w = strategy.workflow!, identity = JSON.stringify({ workflow: w, risk: strategy.risk });
  const [state, setState] = useState<PaperState | null>(null), [running, setRunning] = useState(false), [mode, setMode] = useState<"scenario" | "quotes">("scenario");
  const [items, setItems] = useState<QuoteItem[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const current = useRef<PaperState | null>(null), inflight = useRef(false), generation = useRef(0);
  const setPaper = (s: PaperState | null) => { current.current = s; setState(s); };
  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(checkpointKey) ?? "null"); if (saved?.identity === identity && saved.state?.version === 1 && saved.state?.stages && Number.isFinite(saved.state?.principal)) { setPaper(saved.state); setMode(saved.mode === "quotes" ? "quotes" : "scenario"); setNotice("Previous test restored, paused. Resume to continue; no missing interval was replayed."); } } catch {}
    return () => { generation.current++; };
  }, [identity]);
  useEffect(() => { if (state) { try { localStorage.setItem(checkpointKey, JSON.stringify({ identity, state, mode })); } catch { setNotice("Browser storage is full. Keep this tab open to retain the current test."); } } }, [state, identity, mode]);
  const refresh = async (execute = false) => {
    if (inflight.current) return; inflight.current = true; setBusy(true); setError(null); const gen = generation.current;
    try {
      const r = await fetch("/api/preview/quotes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(w.assets) });
      const data = await r.json() as { message?: string; items: QuoteItem[] }; if (!r.ok) throw new Error(data.message ?? "Could not read market data.");
      if (gen !== generation.current) return;
      const next: QuoteItem[] = data.items.map((x: QuoteItem) => ({ ...x, quote: x.quote ? PaperQuote.parse(x.quote) : null })); setItems(next);
      if (execute && current.current) setPaper(stepPaper(w, current.current, next.flatMap((x) => x.quote ? [x.quote] : []), Date.now(), strategy.risk));
    } catch (e) { if (gen === generation.current) setError(e instanceof Error ? e.message : "Market data is unavailable."); }
    finally { inflight.current = false; setBusy(false); }
  };
  useEffect(() => { if (!running) return; void refresh(true); const id = setInterval(() => { void refresh(true); }, 20_000); return () => clearInterval(id); }, [running]);
  const simulate = () => {
    setRunning(false); setError(null); setNotice(null);
    try { const frames = syntheticFrames(w); let s = createPaper(w, frames[0].at); for (const f of frames) s = stepPaper(w, s, f.quotes, f.at, strategy.risk); setMode("scenario"); setPaper(s); }
    catch (e) { setError(e instanceof Error ? e.message : "Fill the missing test details first."); }
  };
  const start = () => {
    const problems = paperProblems(w, true); if (problems.length) { setError(problems[0]); return; }
    setError(null); setNotice(null); if (mode !== "quotes" || !current.current) setPaper(createPaper(w)); setMode("quotes"); setRunning(true);
  };
  const problems = paperProblems(w), canQuote = w.assets.some((a) => a.resolution?.selectedId);
  return <section className="mt-6 rounded-[14px] border border-line bg-bg-2 p-5 sm:p-6" aria-labelledby="workflow-lab">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="workflow-lab" className="text-[16px] font-medium">Test this workflow</h2><span className="rounded-full border border-line-2 px-3 py-1 text-[12px] text-muted">{running ? "Paper session · tab must stay open" : state ? mode === "scenario" ? "Synthetic scenario" : "Paper session paused" : "Preview lab"}</span></div>
    <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-muted">Test the actual conditions, repeat purchases, exits and profit dependencies. Scenario tests use invented prices. Quote sessions use indicative market prices while this tab stays open, with a modeled 0.1% fee per fill. Order-book slippage, gas and perpetual funding costs are not modeled. Cross-venue balances are virtual; no funds move.</p>
    <div className="mt-4 flex flex-wrap gap-2"><button onClick={simulate} disabled={running || problems.length > 0} className="btn min-h-11 rounded-full border border-line-2 px-4 text-[13px] disabled:opacity-40">Run test scenario</button><button onClick={() => void refresh()} disabled={busy || !canQuote} className="btn min-h-11 rounded-full border border-line-2 px-4 text-[13px] disabled:opacity-40">{busy ? "Reading markets…" : "Check live quotes"}</button>{running ? <button onClick={() => setRunning(false)} className="btn min-h-11 rounded-full border border-accent/40 px-4 text-[13px] text-accent">Pause paper session</button> : <button onClick={start} disabled={busy || paperProblems(w, true).length > 0} className="btn min-h-11 rounded-full bg-accent px-4 text-[13px] text-bg disabled:opacity-40">{mode === "quotes" && state ? "Resume paper session" : "Start paper session"}</button>}</div>
    {problems.length > 0 && <p className="mt-3 text-[13px] text-muted">Complete above: {problems[0]}</p>}
    <p className="mt-3 text-[12px] text-muted">Risk limits apply to simulated orders too. Max position {strategy.risk.maxPositionPct}% of equity; total exposure {strategy.risk.maxTotalExposurePct}%. Change limits on the Risk page, then reopen this draft.</p>
    {items.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2">{items.map((x) => <div key={x.assetId} className="min-w-0 rounded-xl border border-line p-3 text-[12px]"><p className="text-[13px] text-ink-2">{w.assets.find((a) => a.id === x.assetId)?.query} {x.quote ? `· $${x.quote.price.toLocaleString("en-US", { maximumFractionDigits: 10 })}` : "· unavailable"}</p><p className="mt-1 break-words text-muted">{x.quote?.source}</p><p className="mt-1 text-muted">{x.message}</p>{x.quote && <p className="mt-1 text-muted">Observed {new Date(x.quote.observedAt).toLocaleString()}</p>}</div>)}</div>}
    {error && <p role="alert" className="mt-4 text-[13px] text-short">{error}</p>}{notice && <p role="status" className="mt-4 text-[13px] text-muted">{notice}</p>}
    {state && <>
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Equity", paperEquity(state)], ["Available cash", freeCash(state)], ["Realized P&L", state.realized], ["Modeled fees", state.fees]].map(([label, amount]) => <div key={label} className="rounded-xl border border-line p-3"><p className="text-[12px] text-muted">{label}</p><p className="mt-1 font-mono text-[16px]">{dollars(Number(amount))}</p></div>)}</div>
      {state.curve.length > 1 && <div className="mt-4 h-20"><Spark fluid pts={state.curve.map(([, v]) => v)} tone={paperEquity(state) < state.budget ? "short" : "long"} /></div>}
      <div className="mt-4 space-y-2">{w.stages.map((s) => <p key={s.id} className="text-[13px] text-muted"><span className="text-ink-2">{s.id}</span> · {state.stages[s.id]?.fills ?? 0} fills · {state.stages[s.id]?.status}</p>)}</div>
      <details className="mt-4"><summary className="min-h-11 cursor-pointer py-3 text-[13px]">Fill log ({state.events.length})</summary><div className="max-h-80 overflow-auto"><table className="w-full text-left text-[12px]"><thead><tr className="text-muted"><th className="p-2">Time</th><th className="p-2">Stage</th><th className="p-2">Action</th><th className="p-2">Value</th><th className="p-2">Details</th></tr></thead><tbody>{state.events.map((e, i) => <tr key={i} className="border-t border-line"><td className="whitespace-nowrap p-2">{new Date(e.at).toLocaleTimeString()}</td><td className="p-2">{e.stageId}</td><td className="p-2">{e.kind}</td><td className="p-2">{dollars(e.amount)}</td><td className="min-w-40 p-2 text-muted">{e.detail} · price {e.price.toLocaleString("en-US", { maximumFractionDigits: 10 })}</td></tr>)}</tbody></table></div></details>
      <p className="mt-2 text-[12px] text-muted">Checkpoint saved in this browser. Closing the tab stops observation. Reload restores the test paused. This is not historical performance.</p>
    </>}
  </section>;
}
