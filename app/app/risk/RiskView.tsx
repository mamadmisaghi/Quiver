"use client";
import { useEffect, useState } from "react";
import PageHeader from "@/components/PageHeader";
import Wrap from "@/components/Wrap";
import { Card } from "@/components/ui";
import Loading from "@/components/Loading";
import { api, DEMO_LABEL, errOf } from "@/lib/api";
import { Risk, type Strategy } from "@/lib/contracts";
import { useQ } from "@/lib/api/useQ";
export default function RiskView() {
  const list = useQ(() => api.strategies());
  const [pick, setPick] = useState<string | null>(null);
  const id = pick ?? list.data?.items[0]?.id ?? null;
  const rec = useQ(() => (id ? api.strategy(id) : Promise.resolve(null)), [id]);
  const [editing, setEditing] = useState<keyof Strategy["risk"] | null>(null);
  const [draft, setDraft] = useState<Strategy["risk"] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setEditing(null); setError(null); setMsg(null); }, [id]);
  const save = async () => {
    if (!rec.data || rec.data.id !== id || !draft) return;
    setSaving(true); setError(null);
    try {
      const parsed = Risk.safeParse(draft);
      if (!parsed.success) throw new Error("Use 1–100% for percentage limits and a whole number from 1 to 500 for daily orders.");
      await api.updateStrategy(rec.data.id, { ...rec.data.strategy, risk: parsed.data }, rec.data.version);
      setEditing(null); setMsg("Risk limits saved for this strategy."); rec.reload(); list.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save these limits."); }
    finally { setSaving(false); }
  };
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const sw = list.data && list.data.items.length > 0 && (
    <label className="flex items-center gap-2 text-[13px] text-muted">Strategy
      <select value={id ?? ""} disabled={saving} onChange={(e) => setPick(e.target.value)} className="rounded-full border border-line-2 bg-card px-3 py-1.5 text-[13px] text-ink focus:border-accent/50 focus:outline-none">
        {list.data.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </label>);
  const r = rec.data?.strategy.risk;
  if (list.data && !list.data.items.length) return <Wrap><PageHeader title="Risk limits" sub="Draft a strategy first — its limits show up here." /></Wrap>;
  if (!r || !rec.data || rec.data.id !== id) return <Wrap><PageHeader title="Risk limits" sub={DEMO_LABEL} right={sw} /><Loading h={420} q={list.error ? list : rec} /></Wrap>;
  const run = rec.data.activeRunId;
  const L: [keyof Strategy["risk"], string, string, string][] = [
    ["maxPositionPct", "Max position", `${r.maxPositionPct}% of equity`, "Any single position above this is refused."],
    ["maxTotalExposurePct", "Max total exposure", `${r.maxTotalExposurePct}% of equity`, "All open positions across venues, combined."],
    ["maxDailyLossPct", "Daily loss halt", `${r.maxDailyLossPct}%`, "Losing this much in a day pauses the run until you resume it."],
    ["maxOrdersPerDay", "Max orders per day", String(r.maxOrdersPerDay), "Counted across every action in the strategy."],
    ["tradingHours", "Trading hours", r.tradingHours ? `${r.tradingHours.from}–${r.tradingHours.to} ${r.tradingHours.tz}` : "Any time", "Orders outside this window wait."],
    ["equityWhenFeedStale", "When stock prices are stale", r.equityWhenFeedStale === "skip" ? "Skip the trade" : "Use the pool's average price", "Applies while the stock market is closed."],
  ];
  const flatten = async () => {
    if (!run) return;
    try { await api.control(run, "stop_and_flatten"); setMsg("Stopped. Paper positions closed."); } catch (x) { setMsg(errOf(x, "Couldn't stop the run.")); }
    setConfirm(false);
  };
  return (
    <Wrap>
      <PageHeader title="Risk limits" sub={`Limits on “${rec.data.name}” (v${rec.data.version}). Changes stay on this page and update only this strategy.`} right={sw} />
      <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {L.map(([field, k, v, d]) => (
          <Card key={k} className="group p-6">
            <div className="flex items-center justify-between"><div className="text-[13px] text-muted">{k}</div>
              <button type="button" disabled={saving || !!run} onClick={() => { setDraft(structuredClone(r)); setEditing(field); setError(null); setMsg(null); }} className="min-h-11 rounded-full px-3 text-[12.5px] text-muted hover:bg-white/5 hover:text-ink disabled:opacity-40" aria-label={`Edit ${k}`} title={run ? "Stop the active run before editing its saved limits" : undefined}>Edit</button></div>
            {editing === field && draft ? <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <fieldset className="block text-[13px] text-ink-2"><legend>{k}</legend>
                {field === "equityWhenFeedStale" ? <select aria-label={k} autoFocus value={draft.equityWhenFeedStale} onChange={(e) => setDraft({ ...draft, equityWhenFeedStale: e.target.value as "skip" | "use_pool_twap" })} className="mt-2 min-h-11 w-full rounded-lg border border-line-2 bg-bg px-3"><option value="skip">Skip the trade</option><option value="use_pool_twap">Use the pool's average price</option></select>
                : field === "tradingHours" ? <span className="mt-2 block space-y-2">
                  <label className="flex gap-2"><input type="checkbox" checked={!!draft.tradingHours} onChange={(e) => setDraft({ ...draft, tradingHours: e.target.checked ? { from: "09:30", to: "16:00", tz: "America/New_York", days: ["mon", "tue", "wed", "thu", "fri"] } : undefined })} />Limit trading hours</label>
                  {draft.tradingHours && <><span className="flex gap-2">{(["from", "to"] as const).map((f) => <input key={f} aria-label={f === "from" ? "Start time" : "End time"} type="time" value={draft.tradingHours![f]} onChange={(e) => setDraft({ ...draft, tradingHours: { ...draft.tradingHours!, [f]: e.target.value } })} className="min-h-11 min-w-0 w-1/2 rounded-lg border border-line-2 bg-bg px-2" />)}</span>
                    <input aria-label="Time zone" value={draft.tradingHours.tz} onChange={(e) => setDraft({ ...draft, tradingHours: { ...draft.tradingHours!, tz: e.target.value } })} className="min-h-11 w-full rounded-lg border border-line-2 bg-bg px-3" />
                    <span className="flex flex-wrap gap-1">{(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((day) => <label key={day} className="flex min-h-11 items-center gap-1 px-1"><input type="checkbox" checked={draft.tradingHours!.days.includes(day)} onChange={(e) => setDraft({ ...draft, tradingHours: { ...draft.tradingHours!, days: e.target.checked ? [...draft.tradingHours!.days, day] : draft.tradingHours!.days.filter((x) => x !== day) } })} />{day}</label>)}</span></>}
                </span> : <input aria-label={k} autoFocus type="number" min={1} max={field === "maxOrdersPerDay" ? 500 : 100} step={field === "maxOrdersPerDay" ? 1 : "any"} required value={Number.isNaN(draft[field]) ? "" : draft[field]} onChange={(e) => setDraft({ ...draft, [field]: e.target.value === "" ? NaN : Number(e.target.value) })} className="tnum mt-2 min-h-11 w-full rounded-lg border border-line-2 bg-bg px-3 text-[20px] focus:border-accent" />}
              </fieldset>
              <p className="text-[12px] text-muted">Applies only to “{rec.data!.name}”.</p>
              {error && <p role="alert" className="text-[13px] text-short">{error}</p>}
              <div className="flex gap-2"><button disabled={saving} className="btn min-h-11 rounded-full bg-accent px-4 text-[13px] text-bg">{saving ? "Saving…" : "Save"}</button><button type="button" disabled={saving} onClick={() => { setEditing(null); setError(null); }} className="btn min-h-11 rounded-full border border-line-2 px-4 text-[13px]">Cancel</button></div>
            </form> : <><div className="tnum mt-3 font-mono text-[24px] tracking-[-0.02em]">{v}</div><p className="mt-3 text-[13.5px] text-muted">{d}</p></>}
          </Card>
        ))}
      </div>
      <Card className="mt-6 border-short/30 p-6">
        <div className="flex items-center justify-between gap-6">
          <div><div className="font-medium">Stop and flatten</div><p className="mt-1 text-[14px] text-muted">{run ? "Stops this run and closes its paper positions at market." : "This strategy isn't running."}</p></div>
          {!confirm && <button disabled={!run} onClick={() => setConfirm(true)} className="btn shrink-0 rounded-full border border-short/50 px-4 py-2 text-[13px] text-short hover:bg-short/10 disabled:opacity-40">Stop and flatten</button>}
        </div>
        {confirm && (
          <div role="alertdialog" aria-label="Confirm stop and flatten" className="mt-5 flex flex-col gap-3 rounded-[12px] border border-short/30 bg-short/[.06] p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13.5px] text-ink-2">Close every open position in “{rec.data.name}” now? You can&apos;t undo this.</p>
            <div className="flex shrink-0 gap-2"><button onClick={() => setConfirm(false)} className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] hover:bg-white/5">Cancel</button>
              <button onClick={flatten} className="btn rounded-full bg-short px-4 py-2 text-[13px] font-medium text-bg">Yes, stop and flatten</button></div>
          </div>)}
        {msg && <p role="status" className="mt-3 text-[13px] text-muted">{msg}</p>}
      </Card>
    </Wrap>
  );
}
