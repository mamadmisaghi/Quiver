"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { Pencil, Check, ShieldCheck, Clock3 } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import Wrap from "@/components/Wrap";
import { Card } from "@/components/ui";
import DisclosurePanel from "@/components/DisclosurePanel";
import Loading from "@/components/Loading";
import { api, API_MODE, DEMO_LABEL, errOf } from "@/lib/api";
import { Risk, type Strategy } from "@/lib/contracts";
import { useQ } from "@/lib/api/useQ";
export default function RiskView() {
  const list = useQ(async () => {
    const data = await api.strategies();
    return { ...data, requested: new URLSearchParams(window.location.search).get("strategy") };
  });
  const [pick, setPick] = useState<string | null>(null);
  const items = list.data?.items;
  const requested = items?.find(item => item.id === list.data?.requested);
  const id = pick ?? requested?.id ?? items?.[0]?.id ?? null;
  const selectStrategy = (strategyId: string) => {
    setPick(strategyId);
    const url = new URL(window.location.href);
    url.searchParams.set("strategy", strategyId);
    window.history.replaceState(window.history.state, "", url);
  };
  const rec = useQ(() => (id ? api.strategy(id) : Promise.resolve(null)), [id]);
  const returnFocus = useRef<string | null>(null);
  const editButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const [editing, setEditing] = useState<keyof Strategy["risk"] | null>(null);
  const [draft, setDraft] = useState<Strategy["risk"] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [displayedId, setDisplayedId] = useState(id);
  if (displayedId !== id) {
    setDisplayedId(id); setEditing(null); setConfirm(false); setError(null);
  }
  const save = async () => {
    if (!rec.data || rec.data.id !== id || !draft) return;
    setSaving(true); setError(null);
    try {
      const parsed = Risk.safeParse(draft);
      if (!parsed.success) throw new Error("Use 1–100% for percentage limits and a whole number from 1 to 500 for daily orders.");
      const hours = parsed.data.tradingHours;
      if (hours) {
        if (![hours.from, hours.to].every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time)) || hours.from === hours.to)
          throw new Error("Choose two different valid times.");
        try { new Intl.DateTimeFormat("en", { timeZone: hours.tz }).format(0); }
        catch { throw new Error("Use a valid time zone, for example America/New_York."); }
      }
      const next = { ...rec.data.strategy, risk: parsed.data };
      if (next.workflow) next.workflow = { ...next.workflow, risk: {
        ...next.workflow.risk, maxPositionPct: parsed.data.maxPositionPct,
        maxTotalExposurePct: parsed.data.maxTotalExposurePct, maxDailyLossPct: parsed.data.maxDailyLossPct,
        maxOrdersPerDay: parsed.data.maxOrdersPerDay,
      } };
      if (rec.data.activeRunId) {
        const name = `${next.name.slice(0, 68)} · Draft`;
        const saved = await api.createStrategy({ ...next, name, ...(next.workflow ? { workflow: { ...next.workflow, name } } : {}) });
        selectStrategy(saved.id);
        setMsg(`Saved “${saved.name}” with your limits. The running session keeps its original version.`);
      } else {
        await api.updateStrategy(rec.data.id, next, rec.data.version);
        setMsg("Risk limits saved for this strategy.");
        rec.reload();
      }
      returnFocus.current = editing;
      setEditing(null);
      list.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save these limits."); }
    finally { setSaving(false); }
  };
  useLayoutEffect(() => { if (!saving && !editing && returnFocus.current) { editButtons.current[returnFocus.current]?.focus({ preventScroll: true }); returnFocus.current = null; } }, [saving, editing]);
  const [msg, setMsg] = useState<string | null>(null);
  const sw = list.data && list.data.items.length > 0 && (
    <label className="flex items-center gap-2 text-[13px] text-muted">Strategy
      <select value={id ?? ""} disabled={saving} onChange={(e) => { setMsg(null); selectStrategy(e.target.value); }} className="q-control max-w-[min(380px,65vw)] text-[13px]">
        {list.data.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </label>);
  const closeEditor = () => { if (saving) return; returnFocus.current = editing; setEditing(null); setError(null); };
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
    setSaving(true);
    try { await api.control(run, "stop_and_flatten"); rec.reload(); list.reload(); setMsg("Stopped. Paper positions closed."); } catch (x) { setMsg(errOf(x, "Couldn't stop the run.")); }
    setConfirm(false); setSaving(false);
  };
  return (
    <Wrap>
      <PageHeader title="Risk limits" sub={`Set the boundaries for “${rec.data.name}”. Each limit applies to this strategy.`} right={sw} />
      {msg && <p role="status" className="mt-5 flex items-center gap-2 text-[13px] text-accent"><Check size={15} />{msg}</p>}
      <div className="q-risk q-settings mt-8 grid items-start gap-5 xl:grid-cols-2">
        {[{ title: "Capital limits", help: "Position size, exposure and daily drawdown.", icon: ShieldCheck, rows: L.slice(0, 3) }, { title: "Execution rules", help: "Order frequency, timing and stale prices.", icon: Clock3, rows: L.slice(3) }].map(({ title, help, icon: Icon, rows }) => <Card key={title} className="q-risk-panel overflow-hidden">
          <div className="flex items-center gap-3 border-b border-line px-5 py-5 sm:px-6"><Icon size={19} strokeWidth={1.5} className="shrink-0 text-muted" /><div><h2 className="text-[15px] font-medium">{title}</h2><p className="mt-1 text-[12.5px] text-muted">{help}</p></div></div>
          <div className="divide-y divide-line">{rows.map(([field, k, v, d]) => {
            const expanded = editing === field;
            const values = expanded && draft ? draft : r;
            return <div key={field} className="q-risk-row px-5 pt-5 sm:px-6" data-editing={expanded}
              data-range={expanded && ["maxPositionPct", "maxTotalExposurePct", "maxDailyLossPct"].includes(field)}>
            <div className="q-risk-summary">
              <h3 className="q-risk-name">{k}</h3>
              <p className="q-risk-value tnum">{v}</p>
              <p className="q-risk-help">{d}</p>
              <button ref={(el) => { editButtons.current[field] = el; }} type="button" disabled={saving} onClick={() => { if (editing === field) { closeEditor(); return; } setDraft(structuredClone(r)); setEditing(field); setError(null); setMsg(null); }} className={`q-action shrink-0 px-3 ${editing === field ? "border-accent/40 text-accent" : ""}`} aria-label={`Edit ${k}`} aria-expanded={editing === field} aria-controls={`risk-edit-${field}`} title={run ? "Edit limits for a new draft of this strategy" : undefined}><Pencil size={13} />Edit</button>
            </div>
            <DisclosurePanel open={expanded} focusFirst id={`risk-edit-${field}`}><form className="q-risk-editor q-edit-panel -mx-5 mt-4 space-y-4 px-5 pb-5 pt-4 sm:-mx-6 sm:px-6" onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); closeEditor(); } }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
              {run && <div className="q-risk-copy-note">Save a separate draft to use these limits in your next paper session.</div>}
              <fieldset disabled={saving} className="block text-[13px] text-ink-2"><legend className="text-[12px] text-muted">New {k.toLowerCase()}{field === "maxOrdersPerDay" ? "" : field.startsWith("max") ? " (%)" : ""}</legend>
                {field === "equityWhenFeedStale" ? <select aria-label={k} value={values.equityWhenFeedStale} onChange={(e) => setDraft({ ...values, equityWhenFeedStale: e.target.value as "skip" | "use_pool_twap" })} className="q-control mt-2"><option value="skip">Skip the trade</option><option value="use_pool_twap">Use the pool&apos;s average price</option></select>
                : field === "tradingHours" ? <span className="mt-2 block space-y-2">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2.5"><input type="checkbox" checked={!!values.tradingHours} onChange={(e) => setDraft({ ...values, tradingHours: e.target.checked ? { from: "09:30", to: "16:00", tz: "America/New_York", days: ["mon", "tue", "wed", "thu", "fri"] } : undefined })} />Limit trading hours</label>
                  {values.tradingHours && <><span className="flex gap-2">{(["from", "to"] as const).map((f) => <input key={f} aria-label={f === "from" ? "Start time" : "End time"} type="time" value={values.tradingHours![f]} onChange={(e) => setDraft({ ...values, tradingHours: { ...values.tradingHours!, [f]: e.target.value } })} className="min-h-11 min-w-0 w-1/2 rounded-lg border border-line-2 bg-bg px-2" />)}</span>
                    <input aria-label="Time zone" value={values.tradingHours.tz} onChange={(e) => setDraft({ ...values, tradingHours: { ...values.tradingHours!, tz: e.target.value } })} className="q-control" />
                    <span className="flex flex-wrap gap-1">{(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map((day) => <label key={day} className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-line-2 px-2.5 has-checked:border-accent/40 has-checked:bg-accent/5"><input type="checkbox" checked={values.tradingHours!.days.includes(day)} onChange={(e) => setDraft({ ...values, tradingHours: { ...values.tradingHours!, days: e.target.checked ? [...values.tradingHours!.days, day] : values.tradingHours!.days.filter((x) => x !== day) } })} />{day}</label>)}</span></>}
                </span> : <div className="q-number-editor"><input aria-label={k} type="number" min={1} max={field === "maxOrdersPerDay" ? 500 : 100} step={field === "maxOrdersPerDay" ? 1 : "any"} required value={Number.isNaN(values[field]) ? "" : values[field]} onChange={(e) => setDraft({ ...values, [field]: e.target.value === "" ? NaN : Number(e.target.value) })} className="q-control tnum mt-2 text-[20px]" />{field !== "maxOrdersPerDay" && <><span className="q-percent-suffix" aria-hidden="true">%</span><input aria-label={`${k} slider`} type="range" min={1} max={100} step={1} value={Number.isFinite(Number(values[field])) ? Number(values[field]) : 1} onChange={(e) => setDraft({ ...values, [field]: Number(e.target.value) })} className="q-risk-range" /><span className="q-range-labels" aria-hidden="true"><span>1%</span><span>25%</span><span>50%</span><span>100%</span></span></>}</div>}
              </fieldset>
              <p className="text-[12px] text-muted">Applies only to “{rec.data!.name}”.</p>
              {error && <p role="alert" className="text-[13px] text-short">{error}</p>}
              <div className="flex gap-2"><button disabled={saving} className="q-action q-primary">{saving ? "Saving…" : run ? "Save as draft" : "Save changes"}</button><button type="button" disabled={saving} onClick={closeEditor} className="q-action">Cancel</button></div>
            </form></DisclosurePanel>
          </div>; })}</div>
        </Card>)}
      </div>
      {run && <p className="mt-3 text-[12.5px] text-muted">{API_MODE === "mock" ? "This example has a paper run. Edit a limit to save your own draft." : "Changes to running strategies are saved as a new draft."}</p>}
      <Card className="mt-6 border-short/30 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="font-medium">Stop and flatten</div><p className="mt-1 text-[14px] text-muted">{run ? "Stops this run and closes its paper positions at market." : "This strategy isn't running."}</p></div>
          {!confirm && <button disabled={!run || saving} onClick={() => setConfirm(true)} className="btn shrink-0 rounded-full border border-short/50 px-4 py-2 text-[13px] text-short hover:bg-short/10 disabled:opacity-40">Stop and flatten</button>}
        </div>
        {confirm && (
          <div role="alertdialog" aria-label="Confirm stop and flatten" className="mt-5 flex flex-col gap-3 rounded-[12px] border border-short/30 bg-short/[.06] p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13.5px] text-ink-2">Close every open position in “{rec.data.name}” now? You can&apos;t undo this.</p>
            <div className="flex shrink-0 gap-2"><button onClick={() => setConfirm(false)} className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] hover:bg-white/5">Cancel</button>
              <button disabled={saving} onClick={flatten} className="btn rounded-full bg-short px-4 py-2 text-[13px] font-medium text-bg">Yes, stop and flatten</button></div>
          </div>)}

      </Card>
    </Wrap>
  );
}
