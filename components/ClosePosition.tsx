"use client";
// M4.1: partial close (paper only). POST /runs/:id/positions/close {instrument, pct}; 0 < pct ≤ 100, ≤ 2 decimals.
// Always a confirm step — the presets only fill the amount, the "Close" button sends.
import { useState } from "react";
import { api, ApiErr, fmtNum, type ClosePositionRes } from "@/lib/api";

const PCT = /^\d{1,3}(\.\d{1,2})?$/;
const ERR: Record<string, string> = {
  mode_not_enabled: "Partial close is paper-only for now.", conflict: "This run has stopped, so its positions can’t be closed here.",
  not_found: "There’s no open position in this instrument any more.",
};
export default function ClosePosition({ runId, instrument, label, onCancel, onDone }: { runId: string; instrument: string; label: string; onCancel: () => void; onDone: (r: ClosePositionRes) => void }) {
  const [pct, setPct] = useState("50");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<ClosePositionRes | null>(null);
  const n = Number(pct);
  const bad = !PCT.test(pct) || n <= 0 || n > 100;
  const send = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.closePosition(runId, { instrument, pct: n }); setRes(r); if (r.status === "filled") onDone(r); }
    catch (x) { setErr(x instanceof ApiErr ? ERR[x.code] ?? x.message : "Couldn’t close the position."); }
    finally { setBusy(false); }
  };
  if (res) return (
    <div role="status" className="flex flex-wrap items-center gap-3 text-[13px]" data-testid="close-result" data-status={res.status}>
      {res.status === "filled"
        ? <span className="text-ink-2">{res.closedFully ? `Closed all of ${label}.` : `Closed ${res.requestedPct}% of ${label} · ${fmtNum(res.remaining?.qty ?? "0", 4)} left.`} <span className="text-paper">Simulated</span></span>
        : <span className="text-short">Not closed — {res.rejection?.message ?? "the order didn’t fill."}</span>}
      <button onClick={onCancel} className="btn rounded-full border border-line-2 px-3 py-1 text-[12.5px] hover:bg-white/5">Done</button>
    </div>);
  return (
    <div className="grid gap-2 font-sans text-[13px]" role="group" aria-label={`Close part of ${label}`} data-testid="close-confirm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink-2">Close</span>
        {["25", "50", "100"].map((p) => <button key={p} onClick={() => setPct(p)} aria-pressed={pct === p} className="btn rounded-full border border-line-2 px-3 py-1 text-[12.5px] tabular-nums hover:bg-white/5 aria-pressed:border-accent/60 aria-pressed:text-accent">{p}%</button>)}
        <label className="flex items-center gap-1 text-muted"><span className="sr-only">Custom percent</span>
          <input value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" aria-invalid={bad} aria-describedby={bad ? "close-err" : undefined} className="w-16 rounded-[6px] border border-line-2 bg-transparent px-1.5 py-0.5 text-right font-mono tabular-nums text-ink focus:border-accent/60 focus:outline-none aria-[invalid=true]:border-short/70" />%</label>
        <span className="text-muted">of {label}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={send} disabled={busy || bad} className="btn rounded-full bg-short px-4 py-1.5 text-[12.5px] font-medium text-bg disabled:opacity-40">{busy ? "Closing…" : n === 100 ? "Close position" : `Close ${bad ? "" : `${n}%`}`}</button>
        <button onClick={onCancel} className="btn rounded-full border border-line-2 px-4 py-1.5 text-[12.5px] hover:bg-white/5">Cancel</button>
        <span className="text-[12px] text-muted">Paper · fills at the current reference price</span>
      </div>
      {bad && <span id="close-err" role="alert" className="text-[12.5px] text-short">Enter a percent above 0 and up to 100, with at most 2 decimals.</span>}
      {err && <span role="alert" className="text-[12.5px] text-short">{err}</span>}
    </div>
  );
}
