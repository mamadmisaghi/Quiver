"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search, CircleHelp, ArrowUpRight } from "lucide-react";
import { MarketResolution, type Workflow, workflowBlockers } from "@/lib/contracts";

const sideName: Record<string, string> = { buy: "Buy", sell: "Sell", long: "Long", short: "Short", close: "Close" };
const unitName: Record<string, string> = { usd: "USD", pct_equity: "% of equity", native: "tokens", pct_profits: "% of profit", pct_position: "% of position" };
function Group({ title, help, children }: { title: string; help: string; children: React.ReactNode }) {
  return <div className="grid gap-5 border-t border-line py-6 md:grid-cols-[168px_minmax(0,1fr)] md:gap-8"><div><h3 className="text-[14px] font-medium">{title}</h3><p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{help}</p></div><div className="min-w-0">{children}</div></div>;
}
export default function WorkflowReview({ workflow: w, onChange, onClarify }: { workflow: Workflow; onChange: (w: Workflow) => void; onClarify?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null), [message, setMessage] = useState<{ id: string; text: string } | null>(null);
  const [queries, setQueries] = useState<Record<string, string>>({}), [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const latest = useRef(w); useEffect(() => { latest.current = w; }, [w]);
  const setAsset = (id: string, update: Partial<Workflow["assets"][number]>) => onChange({ ...latest.current, assets: latest.current.assets.map((a) => a.id === id ? { ...a, ...update } : a) });
  const search = async (id: string) => {
    const a = latest.current.assets.find((v) => v.id === id)!; setBusy(id); setMessage(null);
    try {
      const { resolution: _, ...input } = a;
      const query = (queries[id] ?? a.query).trim(); if (!query) throw new Error("Enter a ticker, mint or event title.");
      const r = await fetch("/api/preview/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, query, sourceText: query }) });
      const data = await r.json() as { message?: string }; if (!r.ok) throw new Error(data.message ?? "Lookup failed. Retry shortly.");
      setAsset(id, { query, sourceText: query, resolution: MarketResolution.parse(data) });
      setExpanded((v) => ({ ...v, [id]: true }));
    } catch (e) { setMessage({ id, text: e instanceof Error ? e.message : "Could not look up this market." }); }
    finally { setBusy(null); }
  };
  const blockers = workflowBlockers(w);
  return <section className="q-settings mt-6 rounded-[14px] border border-line bg-bg-2 px-5 sm:px-6" aria-labelledby="workflow-review">
    <div className="flex flex-wrap items-start justify-between gap-4 py-6"><div><h2 id="workflow-review" className="text-[17px] font-medium">Set up your strategy</h2><p className="mt-1.5 max-w-[60ch] text-[13px] leading-relaxed text-muted">Confirm the markets, allocate a budget and review how each order runs.</p></div><span className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] ${blockers.length ? "border-line-2 text-muted" : "border-accent/30 text-accent"}`}>{!blockers.length && <Check size={13} />}{blockers.length ? `${blockers.length} ${blockers.length === 1 ? "detail" : "details"} to complete` : "Ready to test"}</span></div>
    <Group title="Markets & contracts" help="Choose the exact asset for each part of your strategy.">
      <div className="divide-y divide-line">{w.assets.map((a) => {
        const selected = a.resolution?.candidates.find((c) => c.id === a.resolution?.selectedId), open = expanded[a.id] ?? !selected;
        return <div key={a.id} className="py-3 first:pt-0 last:pb-0">
          <button type="button" className="flex min-h-11 w-full items-center gap-3 rounded-lg text-left" aria-expanded={open} aria-controls={`market-options-${a.id}`} onClick={() => setExpanded({ ...expanded, [a.id]: !open })}>
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border ${selected ? "border-accent/25 text-accent" : "border-line-2 text-muted"}`}>{selected ? <Check size={16} /> : <Search size={16} />}</span>
            <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium">{a.query}</span><span className="mt-0.5 block truncate text-[12px] text-muted">{selected ? `${selected.name} · ${selected.venue}` : "Select a market or paste a contract address"}</span></span>
            <span className="hidden text-[12px] text-muted sm:block">{selected ? "Change" : "Choose"}</span><ChevronDown size={15} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && <div id={`market-options-${a.id}`} className="mt-4 space-y-3">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(a.id); }}><input aria-label={`Search market for ${a.query}`} value={queries[a.id] ?? a.query} maxLength={200} placeholder="Ticker, contract or event" onChange={(e) => setQueries({ ...queries, [a.id]: e.target.value })} className="q-control min-w-0 flex-1" /><button disabled={!!busy} className="q-action shrink-0"><Search size={14} />{busy === a.id ? "Searching…" : "Search"}</button></form>
            <div className="max-h-80 overflow-y-auto rounded-xl border border-line-2">{a.resolution?.candidates.map((c) => <label key={c.id} className={`flex cursor-pointer items-start gap-3 border-b border-line p-3.5 last:border-b-0 transition-colors hover:bg-white/[.025] ${selected?.id === c.id ? "bg-accent/[.04]" : ""}`}>
              <input type="radio" name={`market-${a.id}`} checked={selected?.id === c.id} onChange={() => { setAsset(a.id, { venue: c.venue, kind: c.kind, outcome: c.outcome, resolution: { ...a.resolution!, selectedId: c.id, status: "matched" } }); setExpanded((v) => ({ ...v, [a.id]: false })); }} className="mt-1 h-4 w-4 shrink-0" />
              <span className="min-w-0"><span className="block text-[13px] text-ink">{c.name}</span><span className="mt-1 block text-[12px] text-muted">{c.venue} · {c.source === "preview_catalog" ? "Preview routing" : c.source}{c.endDate ? ` · closes ${c.endDate.slice(0, 10)}` : ""}</span>{c.address && <span className="mt-2 block break-all font-mono text-[11px] leading-relaxed text-muted">{c.address}</span>}</span>
            </label>)}</div>
            <p className="text-[12px] leading-relaxed text-muted">{a.resolution?.message ?? "Search to find a matching market."}</p>
          </div>}
          {selected?.address && !open && <p className="mt-2 break-all pl-12 font-mono text-[11px] leading-relaxed text-muted">{selected.address}</p>}
          {message?.id === a.id && <p role="alert" className="mt-2 text-[13px] text-short">{message.text}</p>}
        </div>;
      })}</div>
    </Group>
    <Group title="Starting budget" help="Your allocation for this strategy, including modeled costs.">
      <label className="block max-w-xs"><span className="sr-only">Strategy budget (USD)</span><span className="relative block"><input type="number" min="0.01" step="any" placeholder="Enter budget" value={w.budgetUsd ?? ""} onChange={(e) => onChange({ ...w, budgetUsd: Number(e.target.value) > 0 ? Number(e.target.value) : null })} className="q-control pr-14 font-mono text-[18px]" /><span className="pointer-events-none absolute right-3 top-3.5 text-[12px] text-muted">USD</span></span></label>
      <p className="mt-2.5 text-[12px] leading-relaxed text-muted">Purchases stop when the next full order and its fees no longer fit.</p>
    </Group>
    <Group title="Rules & amounts" help="Check the conditions, order sizes and repeat behavior.">
      {w.signals.filter((s) => s.kind === "drawdown").map((s) => <div key={s.id} className="mb-5 border-b border-line pb-5">
        <label className="block text-[13px] text-ink-2">Measure {w.assets.find((a) => a.id === s.assetId)?.query} drop from<select aria-label={`Drop reference for ${s.id}`} value={s.drawdown?.reference ?? "needs_choice"} onChange={(e) => onChange({ ...w, signals: w.signals.map((x) => x.id === s.id ? { ...x, drawdown: { reference: e.target.value as "peak" | "last_fill" | "lookback" | "needs_choice", lookbackMinutes: x.drawdown?.lookbackMinutes ?? 1440 } } : x) })} className="q-control mt-2"><option value="needs_choice">Choose a price reference</option><option value="peak">Peak since start / last purchase</option><option value="last_fill">Price at start / last purchase</option><option value="lookback">Price a fixed time ago</option></select></label>
        {s.drawdown?.reference === "lookback" && <label className="mt-3 block text-[12px] text-muted">Lookback (minutes)<input aria-label={`Lookback minutes for ${s.id}`} type="number" min="1" value={s.drawdown.lookbackMinutes ?? ""} onChange={(e) => onChange({ ...w, signals: w.signals.map((x) => x.id === s.id ? { ...x, drawdown: { ...x.drawdown!, lookbackMinutes: Number(e.target.value) || null } } : x) })} className="q-control mt-1 max-w-40" /></label>}
        <p className="mt-2 text-[12px] leading-relaxed text-muted">One purchase per new decline. A time-window rule waits for enough observed history.</p>
      </div>)}
      <div className="space-y-5">{w.stages.map((s, index) => <div key={s.id} className="border-b border-line pb-5 last:border-b-0 last:pb-0">
        <div className="flex items-center gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line-2 font-mono text-[11px] text-muted">{index + 1}</span><h4 className="text-[14px] font-medium">{sideName[s.side] ?? s.side} {w.assets.find((a) => a.id === s.assetId)?.query}{s.leverage > 1 ? ` · ${s.leverage}×` : ""}</h4></div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{s.conditionText || "When started"}{s.after.length ? ` · After ${s.after.map((d) => `${w.assets.find((a) => a.id === w.stages.find((s) => s.id === d.stageId)?.assetId)?.query ?? d.stageId} ${d.event.replaceAll("_", " ")}`).join("; ")}` : ""}</p>
        <div className="mt-3 grid items-end gap-3 sm:grid-cols-[minmax(120px,180px)_minmax(0,1fr)]"><label className="block text-[12px] text-muted">Order amount ({unitName[s.amount.unit] ?? s.amount.unit})<input type="number" min="0.00000001" step="any" value={s.amount.value ?? ""} placeholder="Enter amount" onChange={(e) => onChange({ ...w, stages: w.stages.map((x) => x.id === s.id ? { ...x, amount: { ...x.amount, value: Number(e.target.value) > 0 ? Number(e.target.value) : null } } : x) })} className="q-control mt-1.5 font-mono" /></label>
        {s.repeat && <label className="block text-[12px] text-muted">{s.repeat.intervalMinutes ? `Repeat every ${s.repeat.intervalMinutes} min` : "On each new event"}<select aria-label={`Repeat condition for ${s.id}`} value={s.repeat.conditionMode} onChange={(e) => onChange({ ...w, stages: w.stages.map((x) => x.id === s.id ? { ...x, repeat: { ...x.repeat!, conditionMode: e.target.value as "each_time" | "once_then_repeat" | "needs_choice" } } : x) })} className="q-control mt-1.5"><option value="needs_choice">Choose repeat behavior</option><option value="each_time">Check before every purchase</option>{s.repeat.intervalMinutes && <option value="once_then_repeat">Check once, then repeat</option>}</select></label>}</div>
        {s.funding.kind === "profits" && <p className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-accent"><ArrowUpRight size={15} className="shrink-0" />Uses realized, available profit from earlier steps. Waits if there is not enough.</p>}
      </div>)}</div>
    </Group>
    {w.questions.length > 0 && <Group title="A few details" help="Answer these points before starting a test."><ul className="space-y-3 text-[13px] leading-relaxed text-ink-2">{w.questions.map((q) => <li key={q}>{q}</li>)}</ul>{onClarify ? <button type="button" onClick={onClarify} className="q-action q-primary mt-4">Complete these details →</button> : <p className="mt-3 text-[12px] text-muted">Open this draft in the strategy builder to answer these questions.</p>}</Group>}
    {(blockers.length > 0 || w.assumptions.length > 0) && <details className="group border-t border-line py-3 text-[12.5px] text-muted"><summary className="flex list-none items-center gap-2"><CircleHelp size={15} />{blockers.length ? `${blockers.length} remaining ${blockers.length === 1 ? "detail" : "details"}` : "Review defaults"}<ChevronDown size={14} className="ml-auto transition-transform group-open:rotate-180" /></summary><div className="pb-3 pt-2 leading-relaxed">{blockers.length > 0 && <ul className="ml-4 list-disc space-y-2">{blockers.map((q) => <li key={q}>{q}</li>)}</ul>}{w.assumptions.length > 0 && <p className="mt-3">Defaults: {w.assumptions.join(" ")}</p>}</div></details>}
  </section>;
}
