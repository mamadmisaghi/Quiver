"use client";
import { useState } from "react";
import { MarketResolution, type Workflow, workflowBlockers } from "@/lib/contracts";

export default function WorkflowReview({ workflow: w, onChange }: { workflow: Workflow; onChange: (w: Workflow) => void }) {
  const [busy, setBusy] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const [queries, setQueries] = useState<Record<string, string>>({});
  const setAsset = (id: string, update: Partial<Workflow["assets"][number]>) => onChange({ ...w, assets: w.assets.map((a) => a.id === id ? { ...a, ...update } : a) });
  const search = async (id: string) => {
    const a = w.assets.find((v) => v.id === id)!; setBusy(id); setMessage(null);
    try {
      const { resolution: _, ...input } = a;
      const query = (queries[id] ?? a.query).trim(); if (!query) throw new Error("Enter a ticker, mint or event title.");
      const r = await fetch("/api/preview/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, query, sourceText: query }) });
      const data = await r.json() as { message?: string }; if (!r.ok) throw new Error(data.message ?? "Lookup failed. Retry shortly.");
      setAsset(id, { query, sourceText: query, resolution: MarketResolution.parse(data) });
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not look up this market."); }
    finally { setBusy(null); }
  };
  const blockers = workflowBlockers(w);
  return <section className="mt-6 rounded-[14px] border border-line bg-bg-2 p-5 sm:p-6" aria-labelledby="workflow-review">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="workflow-review" className="text-[16px] font-medium">Review your workflow</h2><span className="rounded-full border border-accent/30 px-3 py-1 text-[12px] text-accent">Draft · execution not activated</span></div>
    <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{w.summary}</p>
    <p className="mt-2 text-[12.5px] text-muted">{w.stages.length} action{w.stages.length === 1 ? "" : "s"}. Conditions, repeat rules and profit sources are preserved below. Save this draft while completing the missing details.</p>
    <div className="mt-5 grid gap-4 md:grid-cols-2">
      {w.assets.map((a) => <div key={a.id} className="min-w-0 rounded-xl border border-line p-4">
        <div className="flex items-start justify-between gap-2"><div><p className="text-[14px] font-medium">{a.query}</p><p className="mt-1 text-[12px] text-muted">{a.venue ?? "Venue to confirm"}{a.outcome ? ` · ${a.outcome}` : ""}</p></div><span className="text-[11px] text-muted">{a.resolution?.selectedId ? "Selected" : "Needs a match"}</span></div>
        {a.resolution?.candidates.map((c) => <label key={c.id} className={`mt-3 flex min-h-11 cursor-pointer gap-2 rounded-lg border p-3 text-[12.5px] ${a.resolution?.selectedId === c.id ? "border-accent/50 bg-accent/[.04]" : "border-line-2"}`}>
          <input type="radio" name={`market-${a.id}`} checked={a.resolution?.selectedId === c.id} onChange={() => setAsset(a.id, { venue: c.venue, kind: c.kind, outcome: c.outcome, resolution: { ...a.resolution!, selectedId: c.id, status: "matched" } })} className="mt-1 shrink-0 accent-[var(--color-accent)]" />
          <span className="min-w-0"><span className="block text-ink-2">{c.name}</span><span className="mt-1 block text-muted">{c.venue} · {c.source === "preview_catalog" ? "Preview routing" : c.source}{c.endDate ? ` · closes ${c.endDate.slice(0, 10)}` : ""}</span>{c.address && <span className="mt-2 block break-all font-mono text-[11px] text-muted">{c.address}</span>}</span>
        </label>)}
        <p className="mt-3 text-[12px] leading-relaxed text-muted">{a.resolution?.message ?? "Market lookup pending."}</p>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(a.id); }}><input aria-label={`Search market for ${a.query}`} value={queries[a.id] ?? a.query} maxLength={200} onChange={(e) => setQueries({ ...queries, [a.id]: e.target.value })} className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-2 bg-bg px-3 text-[13px]" /><button disabled={!!busy} className="btn min-h-11 shrink-0 rounded-full border border-line-2 px-3 text-[12px] disabled:opacity-40">{busy === a.id ? "Looking…" : "Look up"}</button></form>
      </div>)}
    </div>
    <label className="mt-5 block text-[13px] text-ink-2">Strategy budget (USD)<input type="number" min="0.01" step="any" placeholder="Set an allocation" value={w.budgetUsd ?? ""} onChange={(e) => onChange({ ...w, budgetUsd: Number(e.target.value) > 0 ? Number(e.target.value) : null })} className="mt-2 block min-h-11 w-full max-w-xs rounded-lg border border-line-2 bg-bg px-3 text-[14px]" /></label>
    <p className="mt-2 text-[12px] text-muted">A cap for this strategy, including costs. Repeating purchases stop when the next full order and its fees no longer fit.</p>
    {w.stages.map((s, index) => <div key={s.id} className="mt-4 rounded-xl border border-line p-4">
      <p className="text-[14px] font-medium">{index + 1}. {s.side} {w.assets.find((a) => a.id === s.assetId)?.query}</p>
      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-muted">{s.conditionText || "When started"}{s.after.length ? ` · After ${s.after.map((d) => `${d.stageId}: ${d.event.replaceAll("_", " ")}`).join("; ")}` : ""}</p>
      <div className="mt-3 flex flex-wrap items-end gap-4"><label className="text-[12px] text-muted">Amount ({s.amount.unit.replaceAll("_", " ")})<input type="number" min="0.00000001" step="any" value={s.amount.value ?? ""} placeholder="Set amount" onChange={(e) => onChange({ ...w, stages: w.stages.map((x) => x.id === s.id ? { ...x, amount: { ...x.amount, value: Number(e.target.value) > 0 ? Number(e.target.value) : null } } : x) })} className="mt-1 block min-h-11 w-40 rounded-lg border border-line-2 bg-bg px-3 text-[14px] text-ink" /></label>
      {s.repeat && <label className="text-[12px] text-muted">Every {s.repeat.intervalMinutes ?? "?"} min<select aria-label={`Repeat condition for ${s.id}`} value={s.repeat.conditionMode} onChange={(e) => onChange({ ...w, stages: w.stages.map((x) => x.id === s.id ? { ...x, repeat: { ...x.repeat!, conditionMode: e.target.value as "each_time" | "once_then_repeat" | "needs_choice" } } : x) })} className="mt-1 block min-h-11 max-w-full rounded-lg border border-line-2 bg-bg px-3 text-[13px] text-ink"><option value="needs_choice">Choose how to check the condition</option><option value="each_time">Check before every purchase</option><option value="once_then_repeat">Check once to start repeating</option></select></label>}</div>
      {s.funding.kind === "profits" && <p className="mt-3 text-[12px] text-accent">Uses only realized, available profit from {s.funding.from.join(", ")}. If there is not enough, this stage waits.</p>}
    </div>)}
    {w.assumptions.length > 0 && <p className="mt-4 text-[12px] text-muted">Defaults: {w.assumptions.join(" ")}</p>}
    {blockers.length > 0 && <details className="mt-4 text-[13px] text-muted"><summary className="min-h-11 cursor-pointer py-3 text-ink-2">Details to resolve ({blockers.length})</summary><ul className="ml-4 list-disc space-y-2">{blockers.map((q) => <li key={q}>{q}</li>)}</ul><p className="mt-3">Use Refine this draft below for other changes. No live orders or automatic fund transfers are enabled.</p></details>}
    {message && <p role="alert" className="mt-3 text-[13px] text-short">{message}</p>}
  </section>;
}
