"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search, CircleHelp, ArrowUpRight } from "lucide-react";
import { isEquitySymbol } from "@/services/backend/src/venues/registry";
import { MarketResolution, stageMarketProblem, type Workflow } from "@/lib/contracts";

const sideName: Record<string, string> = { buy: "Buy", sell: "Sell", long: "Long", short: "Short", close: "Close" };
const unitName: Record<string, string> = { usd: "USD", pct_equity: "% of equity", native: "tokens", pct_profits: "% of profit", pct_position: "% of position" };
function Group({ title, help, children }: { title: string; help: string; children: React.ReactNode }) {
  return <div className="grid gap-5 border-t border-line py-6 md:grid-cols-[168px_minmax(0,1fr)] md:gap-8"><div><h3 className="text-[14px] font-medium">{title}</h3><p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{help}</p></div><div className="min-w-0">{children}</div></div>;
}
export default function WorkflowReview({ workflow: w, onChange, onClarify, onLookupChange, problems: blockers, showProblems }: {
  workflow: Workflow; onChange: (w: Workflow) => void; onClarify?: () => void;
  onLookupChange: (busy: boolean) => void; problems: string[]; showProblems: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null), [message, setMessage] = useState<{ id: string; text: string } | null>(null);
  const [queries, setQueries] = useState<Record<string, string>>({}), [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const latest = useRef(w); useEffect(() => { latest.current = w; }, [w]);
  const setAsset = (id: string, update: Partial<Workflow["assets"][number]>) => onChange({ ...latest.current, assets: latest.current.assets.map((a) => a.id === id ? { ...a, ...update } : a) });
  const lookup = useRef<AbortController | null>(null);
  useEffect(() => () => {
    lookup.current?.abort();
    lookup.current = null;
    onLookupChange(false);
  }, [onLookupChange]);
  const search = async (id: string, route?: "perp" | "equity") => {
    lookup.current?.abort();
    const controller = new AbortController();
    lookup.current = controller;
    const a = latest.current.assets.find((v) => v.id === id)!; setBusy(id); onLookupChange(true); setMessage(null);
    try {
      const { resolution: _, ...input } = a;
      const selected = a.resolution?.candidates.find((c) => c.id === a.resolution?.selectedId);
      const ticker = route === "equity" ? selected?.symbol.split(":").pop() : undefined;
      const query = (ticker ?? (route ? a.query : queries[id] ?? a.query)).trim(); if (!query) throw new Error("Enter a ticker, mint or event title.");
      const r = await fetch("/api/preview/resolve", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, query, sourceText: query, ...(route === "perp" ? { venue: "hyperliquid", kind: "perp" } : route === "equity" ? { venue: "robinhood", kind: "token" } : {}) }) });
      const data = await r.json() as { message?: string };
      if (controller.signal.aborted) return;
      if (!r.ok) throw new Error(data.message ?? "Lookup failed. Retry shortly.");
      const resolution = MarketResolution.parse(data);
      if (route && !resolution.candidates.length) throw new Error(resolution.message);
      const chosen = resolution.candidates.find((c) => c.id === resolution.selectedId);
      setAsset(id, { query, sourceText: a.sourceText, resolution,
        ...(chosen ? { venue: chosen.venue, kind: chosen.kind, outcome: chosen.outcome } : {}) });
      setExpanded((v) => ({ ...v, [id]: !chosen }));
      if (route && chosen) setMessage({ id, text: "Selected " + chosen.name + " for this paper strategy." });
    } catch (e) { if (!controller.signal.aborted) setMessage({ id, text: e instanceof Error ? e.message : "Could not look up this market." }); }
    finally { if (lookup.current === controller) { lookup.current = null; setBusy(null); onLookupChange(false); } }
  };
  const fixes = new Map<string, string>();
  for (const a of w.assets) {
    const c = a.resolution?.candidates.find((m) => m.id === a.resolution?.selectedId);
    if (!c) fixes.set("Choose the exact market for " + a.query + " to use live quotes.", "market-" + a.id);
    for (const st of w.stages.filter((st) => st.assetId === a.id)) {
      const problem = c && stageMarketProblem(st, c);
      if (problem) fixes.set(problem, c!.kind === "perp" ? "leverage-" + st.id : "market-" + a.id);
    }
  }
  fixes.set("Enter a starting budget for paper trading.", "paper-budget");
  for (const sig of w.signals) {
    fixes.set("Choose the price reference for the drop on " + sig.id + ".", "reference-" + sig.id);
    fixes.set("Set a lookback period on " + sig.id + ".", "lookback-" + sig.id);
  }
  for (const st of w.stages) {
    fixes.set("Set the amount for " + st.id + ".", "amount-" + st.id);
    fixes.set("Choose whether " + st.id + " checks the condition every time or only to start.", "repeat-" + st.id);
  }
  for (const question of w.questions) fixes.set(question, "answer-workflow-questions");
  const goToFix = (problem: string) => {
    const target = fixes.get(problem) ?? "refine-in";
    if (target.startsWith("market-")) setExpanded((v) => ({ ...v, [target.slice(7)]: true }));
    requestAnimationFrame(() => {
      const field = document.getElementById(target);
      field?.focus({ preventScroll: true });
      field?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    });
  };
  return <section className="q-settings mt-6 rounded-[14px] border border-line bg-bg-2 px-5 sm:px-6" aria-labelledby="workflow-review">
    <div className="flex flex-wrap items-start justify-between gap-4 py-6"><div><h2 id="workflow-review" className="text-[17px] font-medium">Set up your strategy</h2><p className="mt-1.5 max-w-[60ch] text-[13px] leading-relaxed text-muted">Confirm the markets, allocate virtual funds and review how each order runs.</p></div><span className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] ${blockers.length ? "border-line-2 text-muted" : "border-accent/30 text-accent"}`}>{!blockers.length && <Check size={13} />}{blockers.length ? `${blockers.length} ${blockers.length === 1 ? "detail" : "details"} to complete` : "Ready for paper trading"}</span></div>
    {blockers.length > 0 && <div role={showProblems ? "alert" : undefined} className="q-setup-issues">
      <h3>{blockers.length === 1 ? "One thing to review" : "Review these details"}</h3>
      <ul>{blockers.map((problem) => <li key={problem}><span>{problem}</span>
        <button type="button" onClick={() => goToFix(problem)}>{fixes.has(problem) ? "Review" : "Refine rule"} <ArrowUpRight size={13} /></button>
      </li>)}</ul>
    </div>}
    <Group title="Paper trading" help="Orders use virtual funds.">
      <p className="q-quote-heading"><span aria-hidden />Live market prices</p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">Paper orders use the selected market’s latest quote while the session page is open. Orders wait when a fresh price is unavailable.</p>
    </Group>
    <Group title="Markets & contracts" help="Choose the exact asset for each part of your strategy.">
      <div className="divide-y divide-line">{w.assets.map((a) => {
        const selected = a.resolution?.candidates.find((c) => c.id === a.resolution?.selectedId);
        const stages = w.stages.filter((st) => st.assetId === a.id);
        const mismatch = selected && stages.map((st) => stageMarketProblem(st, selected)).find(Boolean);
        const needsMarket = !selected || !!mismatch;
        const open = expanded[a.id] ?? needsMarket;
        const stockReference = selected?.venue === "robinhood" && selected.source === "preview_catalog";
        const requiresPerp = stages.some((st) => st.side === "short" || st.leverage > 1);
        return <div key={a.id} className="py-3 first:pt-0 last:pb-0">
          <button type="button" id={"market-" + a.id} data-paper-required={needsMarket || undefined} className="flex min-h-11 w-full items-center gap-3 rounded-lg text-left" aria-expanded={open} aria-controls={`market-options-${a.id}`} onClick={() => setExpanded({ ...expanded, [a.id]: !open })}>
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border ${!needsMarket ? "border-accent/25 text-accent" : "border-line-2 text-muted"}`}>{!needsMarket ? <Check size={16} /> : <Search size={16} />}</span>
            <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium">{a.query}</span><span className="mt-0.5 block truncate text-[12px] text-muted">{stockReference ? selected.name + " · underlying reference via Tiingo" : selected ? `${selected.name} · ${selected.venue}` : "Select a market or paste a contract address"}</span></span>
            <span className="hidden text-[12px] text-muted sm:block">{selected ? "Change" : "Choose"}</span><ChevronDown size={15} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && <div id={`market-options-${a.id}`} className="mt-4 space-y-3">
            {(requiresPerp || stockReference || a.venue === "robinhood") && selected?.kind !== "perp" && <div className="q-market-route"><span>{requiresPerp ? "This order needs a perpetual contract." : "Look up a perpetual if you want to use its mark price."}</span><button type="button" disabled={!!busy} className="q-action" onClick={() => void search(a.id, "perp")}>{busy === a.id ? "Checking market…" : "Find Hyperliquid perpetual"}</button></div>}
            {selected?.kind === "perp" && !requiresPerp && isEquitySymbol(selected.symbol.split(":").pop()!) && <div className="q-market-route"><span>A 1× stock position can use the underlying US equity price.</span><button type="button" disabled={!!busy} className="q-action" onClick={() => void search(a.id, "equity")}>{busy === a.id ? "Checking market…" : "Use stock price reference"}</button></div>}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(a.id); }}><input aria-label={`Search market for ${a.query}`} value={queries[a.id] ?? a.query} maxLength={200} placeholder="Ticker, contract or event" onChange={(e) => setQueries({ ...queries, [a.id]: e.target.value })} className="q-control min-w-0 flex-1" /><button disabled={!!busy} className="q-action shrink-0"><Search size={14} />{busy === a.id ? "Searching…" : "Search"}</button></form>
            <div className="max-h-80 overflow-y-auto rounded-xl border border-line-2 empty:hidden">{a.resolution?.candidates.map((c) => <label key={c.id} className={`flex cursor-pointer items-start gap-3 border-b border-line p-3.5 last:border-b-0 transition-colors hover:bg-white/[.025] ${selected?.id === c.id ? "bg-accent/[.04]" : ""}`}>
              <input type="radio" name={`market-${a.id}`} checked={selected?.id === c.id} onChange={() => { setAsset(a.id, { venue: c.venue, kind: c.kind, outcome: c.outcome, resolution: { ...a.resolution!, selectedId: c.id, status: "matched" } }); setExpanded((v) => ({ ...v, [a.id]: false })); }} className="mt-1 h-4 w-4 shrink-0" />
              <span className="min-w-0"><span className="block text-[13px] text-ink">{c.name}</span><span className="mt-1 block text-[12px] text-muted">{c.venue} · {c.source === "preview_catalog" ? "Underlying price reference" : c.source}{c.endDate ? ` · closes ${c.endDate.slice(0, 10)}` : ""}</span>{c.address && <span className="mt-2 block break-all font-mono text-[11px] leading-relaxed text-muted">{c.address}</span>}</span>
            </label>)}</div>
            <p className="text-[12px] leading-relaxed text-muted">{a.resolution?.message ?? "Search to find a matching market."}</p>
          </div>}
          {selected?.address && !open && <p className="mt-2 break-all pl-12 font-mono text-[11px] leading-relaxed text-muted">{selected.address}</p>}
          {message?.id === a.id && <p role="status" className="mt-2 text-[13px] text-ink-2">{message.text}</p>}
        </div>;
      })}</div>
    </Group>
    <Group title="Starting budget" help="Required for every paper session. This is virtual money.">
      <label className="block max-w-xs"><span className="sr-only">Strategy budget (USD)</span><span className="relative block"><input id="paper-budget" type="number" min="0.01" step="any" required aria-invalid={showProblems && !w.budgetUsd || undefined} aria-describedby="paper-budget-help" data-paper-required={!w.budgetUsd || undefined} placeholder="Enter budget" value={w.budgetUsd ?? ""} onChange={(e) => onChange({ ...w, budgetUsd: Number(e.target.value) > 0 ? Number(e.target.value) : null })} className="q-control pr-14 font-mono text-[18px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" /><span className="pointer-events-none absolute right-3 top-3.5 text-[12px] text-muted">USD</span></span></label>
      <p id="paper-budget-help" className={`mt-2.5 text-[12px] leading-relaxed ${showProblems && !w.budgetUsd ? "text-accent" : "text-muted"}`}>{showProblems && !w.budgetUsd ? "Enter the virtual USD balance this strategy can use." : "Include room for fees. Purchases stop when the next full order and its fees no longer fit."}</p>
    </Group>
    <Group title="Rules & amounts" help="Check the conditions, order sizes and repeat behavior.">
      {w.signals.filter((s) => s.kind === "drawdown").map((s) => <div key={s.id} className="mb-5 border-b border-line pb-5">
        <label className="block text-[13px] text-ink-2">Measure {w.assets.find((a) => a.id === s.assetId)?.query} drop from<select id={"reference-" + s.id} aria-label={`Drop reference for ${s.id}`} data-paper-required={s.drawdown?.reference === "needs_choice" || undefined} value={s.drawdown?.reference ?? "needs_choice"} onChange={(e) => onChange({ ...w, signals: w.signals.map((x) => x.id === s.id ? { ...x, drawdown: { reference: e.target.value as "peak" | "last_fill" | "lookback" | "needs_choice", lookbackMinutes: x.drawdown?.lookbackMinutes ?? 1440 } } : x) })} className="q-control mt-2"><option value="needs_choice">Choose a price reference</option><option value="peak">Peak since start / last purchase</option><option value="last_fill">Price at start / last purchase</option><option value="lookback">Price a fixed time ago</option></select></label>
        {s.drawdown?.reference === "lookback" && <label className="mt-3 block text-[12px] text-muted">Lookback (minutes)<input id={"lookback-" + s.id} data-paper-required={!s.drawdown.lookbackMinutes || undefined} aria-label={`Lookback minutes for ${s.id}`} type="number" min="1" value={s.drawdown.lookbackMinutes ?? ""} onChange={(e) => onChange({ ...w, signals: w.signals.map((x) => x.id === s.id ? { ...x, drawdown: { ...x.drawdown!, lookbackMinutes: Number(e.target.value) || null } } : x) })} className="q-control mt-1 max-w-40" /></label>}
        <p className="mt-2 text-[12px] leading-relaxed text-muted">One purchase per new decline. A time-window rule waits for enough observed history.</p>
      </div>)}
      <div className="space-y-5">{w.stages.map((s, index) => <div key={s.id} className="border-b border-line pb-5 last:border-b-0 last:pb-0">
        <div className="flex items-center gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line-2 font-mono text-[11px] text-muted">{index + 1}</span><h4 className="text-[14px] font-medium">{sideName[s.side] ?? s.side} {w.assets.find((a) => a.id === s.assetId)?.query}{s.leverage > 1 ? ` · ${s.leverage}×` : ""}</h4></div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{s.conditionText || "When started"}{s.after.length ? ` · After ${s.after.map((d) => `${w.assets.find((a) => a.id === w.stages.find((s) => s.id === d.stageId)?.assetId)?.query ?? d.stageId} ${d.event.replaceAll("_", " ")}`).join("; ")}` : ""}</p>
        <div className="mt-3 grid items-end gap-3 sm:grid-cols-[minmax(120px,180px)_minmax(0,1fr)]"><label className="block text-[12px] text-muted">Order amount ({unitName[s.amount.unit] ?? s.amount.unit})<input id={"amount-" + s.id} data-paper-required={s.amount.value === null || undefined} aria-invalid={showProblems && s.amount.value === null || undefined} type="number" min="0.00000001" step="any" value={s.amount.value ?? ""} placeholder="Enter amount" onChange={(e) => onChange({ ...w, stages: w.stages.map((x) => x.id === s.id ? { ...x, amount: { ...x.amount, value: Number(e.target.value) > 0 ? Number(e.target.value) : null } } : x) })} className="q-control mt-1.5 font-mono" /></label>
        {s.repeat && <label className="block text-[12px] text-muted">{s.repeat.intervalMinutes ? `Repeat every ${s.repeat.intervalMinutes} min` : "On each new event"}<select id={"repeat-" + s.id} aria-label={`Repeat condition for ${s.id}`} data-paper-required={s.repeat.conditionMode === "needs_choice" || undefined} value={s.repeat.conditionMode} onChange={(e) => onChange({ ...w, stages: w.stages.map((x) => x.id === s.id ? { ...x, repeat: { ...x.repeat!, conditionMode: e.target.value as "each_time" | "once_then_repeat" | "needs_choice" } } : x) })} className="q-control mt-1.5"><option value="needs_choice">Choose repeat behavior</option><option value="each_time">Check before every purchase</option>{s.repeat.intervalMinutes && <option value="once_then_repeat">Check once, then repeat</option>}</select></label>}</div>
        {(s.side === "short" || s.side === "long" || s.leverage > 1) && <label className="mt-3 block max-w-44 text-[12px] text-muted">Leverage (×)
          <input id={"leverage-" + s.id} type="number" min="1" max="100" step="any" className="q-control mt-1.5 font-mono" key={s.id + ":" + s.leverage} defaultValue={s.leverage}
            onBlur={(e) => { const v = e.currentTarget.valueAsNumber; if (!e.currentTarget.checkValidity() || !Number.isFinite(v)) { e.currentTarget.value = String(s.leverage); return; }
              if (v !== s.leverage) onChange({ ...w, stages: w.stages.map((st) => st.id === s.id ? { ...st, leverage: v } : st) }); }} />
        </label>}
        {s.funding.kind === "profits" && <p className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-accent"><ArrowUpRight size={15} className="shrink-0" />Uses realized, available profit from earlier steps. Waits if there is not enough.</p>}
      </div>)}</div>
    </Group>
    {w.questions.length > 0 && <Group title="A few details" help="Answer these points before starting a test."><ul className="space-y-3 text-[13px] leading-relaxed text-ink-2">{w.questions.map((q) => <li key={q}>{q}</li>)}</ul>{onClarify ? <button type="button" id="answer-workflow-questions" data-paper-required="true" onClick={onClarify} className="q-action q-primary mt-4">Complete these details →</button> : <p className="mt-3 text-[12px] text-muted">Open this draft in the strategy builder to answer these questions.</p>}</Group>}
    {w.assumptions.length > 0 && <details className="group border-t border-line py-3 text-[12.5px] text-muted"><summary className="flex list-none items-center gap-2"><CircleHelp size={15} />Review defaults<ChevronDown size={14} className="ml-auto transition-transform group-open:rotate-180" /></summary><p className="pb-3 pt-2 leading-relaxed">{w.assumptions.join(" ")}</p></details>}
  </section>;
}
