"use client";
// M5.3: write off a stuck paper position (zero recovery). Preview first (GET …/write-off?instrument=), then an explicit
// confirm that POSTs {instrument, confirm:true}. A 409 means the position is still closable → offer the normal close.
import { useEffect, useRef, useState } from "react";
import { api, ApiErr, errCopy, fmtUsd, fmtNum, type WriteOffPreview, type WriteOffRes } from "@/lib/api";

const WHY: Record<string, string> = { no_price: "No price is arriving for it", price_stale: "Its last price is stale", venue_down: "The venue is down", close_rejected: "Closing it was rejected" };
const ERR: Record<string, string> = { mode_not_enabled: "Write-off is for paper runs only.", not_found: "There’s no open position in this instrument any more.", rate_limited: "Too many tries. Wait a minute and try again." };
export default function WriteOff({ runId, instrument, label, onCancel, onDone, onUseClose }: { runId: string; instrument: string; label: string; onCancel: () => void; onDone: (r: WriteOffRes) => void; onUseClose: () => void }) {
  const [pv, setPv] = useState<WriteOffPreview | null>(null);
  const [closable, setClosable] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<WriteOffRes | null>(null);
  // Gate fix: autoFocus didn't fire on the conditional render; focus the safe "Keep it" (least destructive, as in LiveRun's close confirm) after mount.
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirm) keepRef.current?.focus(); }, [confirm]);
  useEffect(() => { let on = true; api.writeOffPreview(runId, instrument).then((p) => on && setPv(p)).catch((x) => on && setErr(x instanceof ApiErr ? ERR[x.code] ?? errCopy(x.code, x.message) : "Couldn’t check this position.")); return () => { on = false; }; }, [runId, instrument]);
  const send = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.writeOff(runId, { instrument, confirm: true }); setRes(r); onDone(r); }
    catch (x) { if (x instanceof ApiErr && (x.code === "conflict" || x.status === 409)) { setConfirm(false); setClosable(x.message); } else setErr(x instanceof ApiErr ? ERR[x.code] ?? errCopy(x.code, x.message) : "Couldn’t write it off."); }
    finally { setBusy(false); }
  };
  const btn = "btn rounded-full border border-line-2 px-4 py-1.5 text-[12.5px] hover:bg-white/5";
  const useClose = <div className="flex flex-wrap items-center gap-2" data-testid="wo-closable"><span className="text-ink-2">{label} can still be closed normally, so a write-off isn’t needed.</span><button onClick={onUseClose} className="btn rounded-full bg-short px-4 py-1.5 text-[12.5px] font-medium text-bg" data-testid="wo-use-close">Close it instead</button><button onClick={onCancel} className={btn}>Cancel</button></div>;
  return (
    <div className="grid gap-2 font-sans text-[13px]" role="group" aria-label={`Write off ${label}`} data-testid="writeoff">
      {res ? <div role="status" className="flex flex-wrap items-center gap-3" data-testid="wo-done"><span className="text-ink-2">Wrote off {fmtNum(res.qty, 4)} {label} · <span className="tabular-nums text-short">{fmtUsd(`-${res.lossUsd}`)}</span> booked. <span className="text-paper">Paper</span></span><button onClick={onCancel} className={btn}>Done</button></div>
      : closable ? useClose
      : !pv ? (err ? null : <span className="text-muted" role="status">Checking whether {label} can be closed…</span>)
      : !pv.eligible ? useClose
      : <>
          <p className="text-ink-2" data-testid="wo-preview">{pv.reasons.map((r) => WHY[r] ?? r).join(" · ")}. {pv.message}</p>
          <p className="text-muted">Writing off books this at zero recovery: {pv.position ? <span className="font-mono tabular-nums">{fmtNum(pv.position.qty, 4)} @ {fmtUsd(pv.position.avgEntry)}</span> : null}{pv.lossUsd != null && <> · loss <span className="font-mono tabular-nums text-short" data-testid="wo-loss">{fmtUsd(`-${pv.lossUsd}`)}</span></>}. It can’t be undone.</p>
          {!confirm ? <div className="flex flex-wrap gap-2"><button onClick={() => setConfirm(true)} className="btn rounded-full border border-short/60 px-4 py-1.5 text-[12.5px] text-short hover:bg-short/10" data-testid="wo-start">Write off…</button><button onClick={onCancel} className={btn}>Cancel</button></div>
          : <div role="alertdialog" aria-label={`Confirm write-off of ${label}`} className="flex flex-wrap items-center gap-2 rounded-[8px] border border-short/40 p-3" data-testid="wo-confirm">
              <span className="text-ink">Write off {label}{pv.lossUsd != null ? ` for a ${fmtUsd(pv.lossUsd)} loss` : ""}?</span>
              <button onClick={send} disabled={busy} className="btn rounded-full bg-short px-4 py-1.5 text-[12.5px] font-medium text-bg disabled:opacity-40" data-testid="wo-send">{busy ? "Writing off…" : "Yes, write it off"}</button>
              <button ref={keepRef} onClick={() => setConfirm(false)} className={btn} data-testid="wo-keep">Keep it</button>
            </div>}
        </>}
      {err && <span role="alert" className="text-[12.5px] text-short">{err}</span>}
    </div>
  );
}
