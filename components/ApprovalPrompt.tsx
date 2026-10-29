"use client";
// M4.2: confirm-each approval. Shown from the run stream's approval_requested (and GET /approvals on load);
// Approve/Reject → POST /approvals/:id. 409 = already resolved, or the run is paused/halted. Approved orders can
// still come back result.status "rejected" (risk gate and price are re-checked on approve).
import { useEffect, useState } from "react";
import { api, ApiErr, errCopy, fmtUsd, fmtInstrument, type Approval, errOf } from "@/lib/api";
import VenueMark from "./VenueMark";

export type Pending = Pick<Approval, "id" | "actionId" | "instrument" | "venue" | "side" | "notionalUsd" | "expiresAt"> & { runId?: string; strategyName?: string; actionTitle?: string };
const SIDE: Record<string, string> = { buy: "Buy", sell: "Sell", long: "Long", short: "Short" };
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export function resultNote(a: Approval): string {
  if (a.status === "rejected") return "Rejected. No order was placed.";
  if (a.status === "expired") return "Expired before you answered. No order was placed.";
  if (a.status === "canceled") return "Canceled — the run moved on.";
  if (a.result?.status === "filled") return "Approved and filled.";
  if (a.result) return `Approved, but not filled: ${a.result.code === "run_halted" || a.result.code === "run_paused" ? errCopy(a.result.code) : a.result.message ?? (a.result.code ? errCopy(a.result.code) : "the order was rejected.")}`;
  return "Approved. Placing the order…";
}

/** M4.6: approve → 409 conflict with error.details {runStatus, haltReason?}; the approval stays pending. No details = already resolved. */
type Blocked = { status: "paused" | "halted" | "stopped" | "aborted"; haltReason?: string };
function blockedOf(x: ApiErr): Blocked | null {
  const d = x.details as { runStatus?: unknown; haltReason?: unknown } | undefined;
  const st = d?.runStatus;
  if (st !== "paused" && st !== "halted" && st !== "stopped" && st !== "aborted") return null;
  const hr = typeof d?.haltReason === "string" ? d.haltReason : undefined; // "rule_code: Human text." → human text
  return { status: st, haltReason: hr ? (/^[a-z_]+: (.+)$/.exec(hr)?.[1] ?? hr) : undefined };
}

export default function ApprovalPrompt({ item, title, onResolved, runId, onResumed }: { item: Pending; title: string; onResolved: (id: string, note: string) => void; runId?: string; onResumed?: () => void }) {
  const rid = runId ?? item.runId;
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [resuming, setResuming] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = new Date(item.expiresAt).getTime() - now;
  const expired = left <= 0;
  const decide = async (d: "approve" | "reject") => {
    setBusy(d); setErr(null); setBlocked(null);
    try { const a = await api.decideApproval(item.id, d); onResolved(item.id, resultNote(a)); }
    catch (x) { const st = x instanceof ApiErr && (x.code === "conflict" || x.status === 409) ? blockedOf(x) : null;
      if (st) { setBlocked(st); return; } // still pending: ask to resume, then approve again
      setErr(x instanceof ApiErr && (x.code === "conflict" || x.status === 409) ? "This can’t be answered now — it was already resolved, or the run is paused or halted." : errOf(x, "Couldn’t send your answer.")); }
    finally { setBusy(null); }
  };
  const resume = async () => {
    if (!rid) return; setResuming(true); setErr(null);
    try { await api.control(rid, "resume"); setBlocked(null); onResumed?.(); }
    catch (x) { setErr(errOf(x, "Couldn’t resume the run.")); }
    finally { setResuming(false); }
  };
  return (
    <div role="alertdialog" aria-label={`Approve ${item.actionTitle ?? `${SIDE[item.side]} ${fmtInstrument(item.instrument)}`}`} data-testid="approval-prompt" className="flex flex-col gap-3 rounded-[12px] border border-accent/40 bg-raised p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-[13.5px]">
        <div className="text-[12px] text-muted">Waiting for your approval · <span data-testid="approval-strategy">{item.strategyName ?? title}</span></div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-ink"><VenueMark venue={item.venue} /><span data-testid="approval-title">{item.actionTitle ?? `${SIDE[item.side]} ${fmtInstrument(item.instrument)}`}</span> <span className="font-mono tabular-nums">~{fmtUsd(item.notionalUsd)}</span></div>
        <div className="mt-1 font-mono text-[12px] tabular-nums text-muted" aria-live="off">{expired ? "Expired" : `Expires in ${mmss(left)}`}</div>
        {err && <p role="alert" className="mt-1 text-[12.5px] text-short">{err}</p>}
        {blocked && (
          <div role="alert" data-testid="approval-blocked" data-state={blocked.status} className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-warn">
            <span>{blocked.status === "stopped" || blocked.status === "aborted" ? `The run has ${blocked.status === "stopped" ? "stopped" : "ended"}, so this can’t be approved. You can still reject it.` : `The run is ${blocked.status}. Resume it, then approve — this request stays open until it expires.`}</span>
            {blocked.haltReason && <span className="basis-full text-[12px] text-muted" data-testid="approval-halt-reason">Halted by: <span className="text-ink-2">{blocked.haltReason}</span></span>}
            {(blocked.status === "paused" || blocked.status === "halted") && rid && <button onClick={resume} disabled={resuming} className="btn rounded-full border border-warn/50 px-3 py-1 text-[12.5px] text-warn hover:bg-white/5 disabled:opacity-40">{resuming ? "Resuming…" : "Resume run"}</button>}
          </div>)}
      </div>
      <div className="flex shrink-0 gap-2">
        <button onClick={() => decide("reject")} disabled={!!busy || expired} className="btn rounded-full border border-line-2 px-4 py-2 text-[13px] hover:bg-white/5 disabled:opacity-40">{busy === "reject" ? "Rejecting…" : "Reject"}</button>
        <button onClick={() => decide("approve")} disabled={!!busy || expired} className="btn rounded-full bg-accent px-4 py-2 text-[13px] font-medium text-bg hover:brightness-110 disabled:opacity-40">{busy === "approve" ? "Approving…" : "Approve"}</button>
      </div>
    </div>
  );
}
